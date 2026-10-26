import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageProcessor } from '../src/services/image-processor.ts'
import { DEFAULT_CALIBRATION } from '../src/imaging/segmentation.ts'
import type { PreparedFrame, PrepareResponse } from '../src/imaging/protocol.ts'
import { throwIfAborted, withAbort } from '../src/services/abort.ts'

const instances: WorkerDouble[] = []
let failSending = false
class WorkerDouble {
  onmessage: ((event: MessageEvent<PrepareResponse>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn(() => {
    if (failSending) throw new Error('Ошибка отправки')
  })
  terminate = vi.fn()
  constructor() {
    instances.push(this)
  }
}
const frame: PreparedFrame = { cards: [], fingerprint: 'hash', duplicate: false, durationMs: 1 }
afterEach(() => {
  vi.unstubAllGlobals()
  instances.length = 0
  failSending = false
})
describe('Изолированная обработка изображения', () => {
  it('сообщает об отсутствии поддержки Worker', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(
      new ImageProcessor().prepare(
        new Blob(),
        { ...DEFAULT_CALIBRATION },
        null,
        new AbortController().signal,
      ),
    ).rejects.toThrow('не поддерживает Worker')
  })
  it('возвращает ответ только соответствующему запросу', async () => {
    vi.stubGlobal('Worker', WorkerDouble)
    const processor = new ImageProcessor(),
      signal = new AbortController().signal
    const pending = processor.prepare(new Blob(['x']), { ...DEFAULT_CALIBRATION }, null, signal)
    const worker = instances[0]
    worker?.onmessage?.({ data: { id: 999, ok: true, frame } } as MessageEvent<PrepareResponse>)
    worker?.onmessage?.({ data: { id: 1, ok: true, frame } } as MessageEvent<PrepareResponse>)
    expect(await pending).toEqual(frame)
    processor.dispose()
    expect(worker?.terminate).toHaveBeenCalledOnce()
    await expect(
      processor.prepare(new Blob(), { ...DEFAULT_CALIBRATION }, null, signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('передаёт ошибку worker и допускает повторную попытку', async () => {
    vi.stubGlobal('Worker', WorkerDouble)
    const processor = new ImageProcessor(),
      signal = new AbortController().signal
    const pending = processor.prepare(new Blob(), { ...DEFAULT_CALIBRATION }, null, signal)
    instances[0]?.onmessage?.({
      data: { id: 1, ok: false, error: 'Повреждённое изображение' },
    } as MessageEvent<PrepareResponse>)
    await expect(pending).rejects.toThrow('Повреждённое изображение')
    const next = processor.prepare(new Blob(), { ...DEFAULT_CALIBRATION }, null, signal)
    instances[0]?.onerror?.()
    await expect(next).rejects.toThrow('Сбой обработки')
    const third = processor.prepare(new Blob(), { ...DEFAULT_CALIBRATION }, null, signal)
    instances[1]?.onmessageerror?.()
    await expect(third).rejects.toThrow('Не удалось прочитать')
    processor.dispose()
  })
  it('отменяет запрос и освобождает ожидание при dispose', async () => {
    vi.stubGlobal('Worker', WorkerDouble)
    const processor = new ImageProcessor(),
      controller = new AbortController()
    const first = processor.prepare(new Blob(), { ...DEFAULT_CALIBRATION }, null, controller.signal)
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = processor.prepare(
      new Blob(),
      { ...DEFAULT_CALIBRATION },
      null,
      new AbortController().signal,
    )
    processor.dispose()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('обрабатывает синхронную ошибку отправки', async () => {
    vi.stubGlobal('Worker', WorkerDouble)
    const processor = new ImageProcessor()
    failSending = true
    await expect(
      processor.prepare(new Blob(), { ...DEFAULT_CALIBRATION }, null, new AbortController().signal),
    ).rejects.toThrow('Ошибка отправки')
    processor.dispose()
  })
})
describe('Отмена ожиданий', () => {
  it('отклоняет уже отменённую операцию и сохраняет исходную ошибку', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => throwIfAborted(controller.signal)).toThrow()
    await expect(withAbort(Promise.resolve(1), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await expect(
      withAbort(Promise.reject(new Error('Причина')), new AbortController().signal),
    ).rejects.toThrow('Причина')
  })
})
