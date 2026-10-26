import Tesseract from 'tesseract.js'
import { abortError, throwIfAborted, withAbort } from './abort.ts'

import type { TextReading } from '../domain/model.ts'
import { asError } from '../domain/model.ts'
export type OcrKind = 'name' | 'progress'
export interface OcrInput {
  image: Blob
  kind: OcrKind
}
export interface OcrWorker {
  recognize: (image: Blob, kind: OcrKind) => Promise<TextReading>
  terminate: () => Promise<void>
}
export type WorkerFactory = (signal: AbortSignal) => Promise<OcrWorker>
export function workerLimit(hardwareConcurrency: number): number {
  return Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.min(2, Math.floor(hardwareConcurrency / 2)))
    : 1
}
export function localWorkerFactory(baseUrl: string): WorkerFactory {
  return async (signal) => {
    const assets = new URL('ocr/', baseUrl).href
    const worker = await Tesseract.createWorker(['eng', 'rus'], Tesseract.OEM.LSTM_ONLY, {
      workerPath: new URL('worker.min.js', assets).href,
      corePath: assets,
      langPath: assets,
      gzip: false,
      cacheMethod: 'none',
      workerBlobURL: false,
      signal,
    })
    try {
      await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE })
      return {
        recognize: async (image, kind) => {
          await worker.setParameters({
            tessedit_char_whitelist:
              kind === 'progress'
                ? '0123456789/'
                : 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ *★-\'"()',
          })
          const result = await worker.recognize(image)
          return { text: result.data.text.trim(), confidence: result.data.confidence }
        },
        terminate: async () => {
          await worker.terminate()
        },
      }
    } catch (error) {
      await worker.terminate()
      throw error
    }
  }
}
export class OcrPool {
  private workers: OcrWorker[] = []
  private initialized: Promise<void> | null = null
  private disposed = false
  private running = false
  private controller = new AbortController()
  readonly count: number

  private factory: WorkerFactory
  constructor(factory: WorkerFactory, hardwareConcurrency: number) {
    this.factory = factory
    this.count = workerLimit(hardwareConcurrency)
  }
  ready(signal: AbortSignal): Promise<void> {
    if (this.disposed) return Promise.reject(abortError())
    this.initialized ??= this.initialize()
    return withAbort(withAbort(this.initialized, this.controller.signal), signal)
  }
  private async initialize(): Promise<void> {
    try {
      await Promise.all(
        Array.from({ length: this.count }, async () => {
          const worker = await this.factory(this.controller.signal)
          if (this.disposed) {
            await worker.terminate()
            throw abortError()
          }
          this.workers.push(worker)
        }),
      )
    } catch (error) {
      this.disposed = true
      this.controller.abort(asError(error))
      this.releaseWorkers()
      throw error
    }
  }
  async recognize(images: readonly OcrInput[], signal: AbortSignal): Promise<TextReading[]> {
    await this.ready(signal)
    throwIfAborted(signal)
    if (this.running) throw new Error('OCR уже обрабатывает другую группу изображений')
    this.running = true
    try {
      const results: TextReading[] = new Array<TextReading>(images.length)
      let index = 0
      await Promise.all(
        this.workers.map(async (worker) => {
          for (;;) {
            const current = index++,
              image = images[current]
            if (!image) break
            throwIfAborted(signal)
            results[current] = await withAbort(
              withAbort(worker.recognize(image.image, image.kind), this.controller.signal),
              signal,
            )
          }
        }),
      )
      return results
    } catch (error) {
      this.dispose()
      throw error
    } finally {
      this.running = false
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.controller.abort()
    this.releaseWorkers()
  }
  private releaseWorkers(): void {
    for (const worker of this.workers) void worker.terminate().catch(() => undefined)
    this.workers = []
  }
}
