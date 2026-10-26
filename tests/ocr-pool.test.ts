import { describe, expect, it, vi } from 'vitest'
import { localWorkerFactory, OcrPool, workerLimit } from '../src/services/ocr-pool.ts'
import Tesseract from 'tesseract.js'
import type { OcrWorker } from '../src/services/ocr-pool.ts'
import { deferred, flush } from './helpers.ts'

const worker = (): OcrWorker => ({
  recognize: vi.fn(async (image: Blob) => ({ text: await image.text(), confidence: 90 })),
  terminate: vi.fn(async () => {}),
})
describe('Владение OCR-работниками', () => {
  it.each([0, 1, 2, 4, 32, 256, Infinity, NaN])(
    'ограничивает число работников: %s',
    (n: number) => {
      expect(workerLimit(n)).toBeGreaterThanOrEqual(1)
      expect(workerLimit(n)).toBeLessThanOrEqual(2)
    },
  )
  it('освобождает работников, созданных после отмены инициализации', async () => {
    const created = deferred<OcrWorker>(),
      instance = worker(),
      pool = new OcrPool(() => created.promise, 1)
    const ready = pool.ready(new AbortController().signal).catch((error) => error as Error)
    pool.dispose()
    created.resolve(instance)
    await ready
    await flush()
    expect(instance.terminate).toHaveBeenCalledOnce()
    await expect(pool.ready(new AbortController().signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
  it('освобождает частично созданный пул при ошибке', async () => {
    const first = worker(),
      late = deferred<OcrWorker>(),
      second = worker()
    let calls = 0
    const pool = new OcrPool(() => (++calls === 1 ? Promise.resolve(first) : late.promise), 8)
    const ready = pool.ready(new AbortController().signal)
    await flush()
    late.reject(new Error('Ошибка модели'))
    await expect(ready).rejects.toThrow('Ошибка модели')
    expect(first.terminate).toHaveBeenCalledOnce()
    expect(second.terminate).not.toHaveBeenCalled()
  })
  it('не оставляет поздний успешный worker после ошибки соседнего', async () => {
    const late = deferred<OcrWorker>(),
      instance = worker()
    let calls = 0
    const pool = new OcrPool(
      () => (++calls === 1 ? Promise.reject(new Error('Сбой')) : late.promise),
      4,
    )
    await expect(pool.ready(new AbortController().signal)).rejects.toThrow()
    late.resolve(instance)
    await flush()
    expect(instance.terminate).toHaveBeenCalledOnce()
  })
  it('сохраняет порядок результатов и инициализируется только один раз', async () => {
    const factory = vi.fn(() => Promise.resolve(worker())),
      pool = new OcrPool(factory, 8),
      signal = new AbortController().signal
    await Promise.all([pool.ready(signal), pool.ready(signal)])
    const texts = await pool.recognize(
      ['a', 'b', 'c', 'd'].map((s) => ({ image: new Blob([s]), kind: 'name' })),
      signal,
    )
    expect(texts.map((v) => v.text)).toEqual(['a', 'b', 'c', 'd'])
    expect(factory).toHaveBeenCalledTimes(2)
    pool.dispose()
    pool.dispose()
  })
  it('прерывает ожидание зависшего распознавания', async () => {
    const pending = deferred<{ text: string; confidence: number }>(),
      instance = worker()
    instance.recognize = () => pending.promise
    const pool = new OcrPool(() => Promise.resolve(instance), 1),
      controller = new AbortController()
    const work = pool.recognize([{ image: new Blob(['x']), kind: 'name' }], controller.signal)
    await flush()
    controller.abort()
    await expect(work).rejects.toMatchObject({ name: 'AbortError' })
    pool.dispose()
  })
  it('не запускает две группы на одном наборе работников одновременно', async () => {
    const blocked = deferred<{ text: string; confidence: number }>(),
      instance = worker()
    instance.recognize = () => blocked.promise
    const pool = new OcrPool(() => Promise.resolve(instance), 1),
      signal = new AbortController().signal
    const first = pool.recognize([{ image: new Blob(['a']), kind: 'name' }], signal)
    await flush()
    await expect(
      pool.recognize([{ image: new Blob(['b']), kind: 'progress' }], signal),
    ).rejects.toThrow('другую группу')
    pool.dispose()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('использует локальные модели и освобождает работника при ошибке настройки', async () => {
    const raw = {
      recognize: vi.fn(() => Promise.resolve({ data: { text: ' текст\n', confidence: 90 } })),
      terminate: vi.fn(async () => {}),
      setParameters: vi.fn(async () => {}),
    }
    const factory = vi
      .spyOn(Tesseract, 'createWorker')
      .mockResolvedValue(raw as unknown as Tesseract.Worker)
    const adapted = await localWorkerFactory('http://127.0.0.1:5100/app/')(
      new AbortController().signal,
    )
    expect(factory).toHaveBeenCalledWith(
      ['eng', 'rus'],
      Tesseract.OEM.LSTM_ONLY,
      expect.objectContaining({
        workerPath: 'http://127.0.0.1:5100/app/ocr/worker.min.js',
        gzip: false,
        workerBlobURL: false,
      }),
    )
    expect(await adapted.recognize(new Blob(['x']), 'name')).toEqual({
      text: 'текст',
      confidence: 90,
    })
    await adapted.terminate()
    expect(raw.terminate).toHaveBeenCalledOnce()
    raw.setParameters.mockRejectedValueOnce(new Error('Некорректные параметры'))
    await expect(
      localWorkerFactory('http://127.0.0.1/')(new AbortController().signal),
    ).rejects.toThrow('Некорректные параметры')
    expect(raw.terminate).toHaveBeenCalledTimes(2)
  })
})
