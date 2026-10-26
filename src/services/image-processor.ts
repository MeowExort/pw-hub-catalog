import type { Calibration } from '../imaging/segmentation.ts'
import type { PreparedFrame, PrepareRequest, PrepareResponse } from '../imaging/protocol.ts'
import { abortError, throwIfAborted } from './abort.ts'
import { asError } from '../domain/model.ts'

export class ImageProcessor {
  private worker: Worker | null = null
  private nextId = 0
  private disposed = false
  private pending = new Map<
    number,
    { resolve: (frame: PreparedFrame) => void; reject: (error: Error) => void; cleanup: () => void }
  >()

  async prepare(
    image: Blob,
    calibration: Calibration,
    previousFingerprint: string | null,
    signal: AbortSignal,
  ): Promise<PreparedFrame> {
    throwIfAborted(signal)
    if (this.disposed) return Promise.reject(abortError())
    if (typeof Worker !== 'function')
      throw new Error('Браузер не поддерживает Worker. Используйте актуальный Chrome или Edge.')
    if (!this.worker) {
      this.worker = new Worker(new URL('../imaging/image.worker.ts', import.meta.url), {
        type: 'module',
      })
      this.worker.onmessage = (event: MessageEvent<PrepareResponse>) => {
        const response = event.data,
          job = this.pending.get(response.id)
        if (!job) return
        this.pending.delete(response.id)
        job.cleanup()
        if (response.ok) job.resolve(response.frame)
        else job.reject(new Error(response.error))
      }
      this.worker.onerror = () => this.fail(new Error('Сбой обработки изображения в Worker'))
      this.worker.onmessageerror = () =>
        this.fail(new Error('Не удалось прочитать результат обработки'))
    }
    const worker = this.worker,
      id = ++this.nextId
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id)
        reject(abortError())
      }
      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => signal.removeEventListener('abort', abort),
      })
      const request: PrepareRequest = { id, image, calibration, previousFingerprint }
      try {
        worker.postMessage(request)
      } catch (error) {
        this.pending.delete(id)
        signal.removeEventListener('abort', abort)
        reject(asError(error))
      }
    })
  }
  private fail(error: Error): void {
    for (const job of this.pending.values()) {
      job.cleanup()
      job.reject(error)
    }
    this.pending.clear()
    this.worker?.terminate()
    this.worker = null
  }
  dispose(): void {
    this.disposed = true
    this.fail(abortError())
  }
}
