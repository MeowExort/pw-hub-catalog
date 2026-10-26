import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initialState,
  SessionController,
  validateImageFile,
  MAX_FILE_BYTES,
} from '../src/session/controller.ts'
import type { AnalysisEngine } from '../src/services/analyzer.ts'
import type { CaptureSource } from '../src/services/screen-capture.ts'
import { DEFAULT_CALIBRATION } from '../src/imaging/segmentation.ts'
import type { AnalysisResult } from '../src/domain/model.ts'
import { deferred, flush, result } from './helpers.ts'

function setup(
  engineOverrides: Partial<AnalysisEngine> = {},
  captureOverrides: Partial<CaptureSource> = {},
) {
  const engine: AnalysisEngine = {
    ready: vi.fn(async () => {}),
    analyze: vi.fn(() => Promise.resolve(result())),
    dispose: vi.fn(),
    ...engineOverrides,
  }
  const capture: CaptureSource = {
    start: vi.fn(async () => {}),
    frame: vi.fn(() => Promise.resolve(new Blob(['frame']))),
    dispose: vi.fn(),
    ...captureOverrides,
  }
  const onChange = vi.fn()
  const controller = new SessionController({
    createEngine: () => engine,
    createCapture: () => capture,
    onChange,
    timeoutMs: 10_000,
  })
  return { controller, engine, capture, onChange }
}
const image = () => new File(['png'], 'catalog.png', { type: 'image/png' })
const calibration = { ...DEFAULT_CALIBRATION }
afterEach(() => {
  vi.useRealTimers()
})
describe('Сессия обработки', () => {
  it('ожидает готовности OCR без потери кадров', async () => {
    const ready = deferred<void>(),
      h = setup({ ready: () => ready.promise })
    const start = h.controller.analyzeFile(image(), 'F', calibration)
    await flush()
    expect(h.controller.snapshot()).toMatchObject({
      phase: 'loading',
      stats: { captured: 0, processed: 0 },
    })
    expect(h.engine.analyze).not.toHaveBeenCalled()
    ready.resolve()
    await start
    await flush()
    expect(h.controller.snapshot()).toMatchObject({
      phase: 'stopped',
      stats: { captured: 1, processed: 1, pending: 0 },
    })
    expect(h.engine.dispose).toHaveBeenCalledOnce()
  })
  it('не смешивает результат старой сессии с новой', async () => {
    const old = deferred<AnalysisResult>(),
      first = setup({ analyze: () => old.promise }),
      second = setup()
    let calls = 0
    const controller = new SessionController({
      createEngine: () => (++calls === 1 ? first.engine : second.engine),
      createCapture: () => first.capture,
      onChange: vi.fn(),
    })
    await controller.analyzeFile(image(), 'M', calibration)
    await flush()
    controller.stop()
    await controller.analyzeFile(image(), 'F', calibration)
    await flush()
    const snapshot = controller.snapshot()
    old.resolve(result([]))
    await flush()
    expect(controller.snapshot()).toBe(snapshot)
    expect(snapshot.observations).toHaveLength(1)
    expect(snapshot.stats).toMatchObject({ captured: 1, processed: 1, skipped: 0 })
    expect(first.engine.dispose).toHaveBeenCalledOnce()
  })
  it('ограничивает очередь последним кадром и сохраняет баланс счётчиков', async () => {
    vi.useFakeTimers()
    const blocked = deferred<AnalysisResult>(),
      h = setup({ analyze: () => blocked.promise })
    await h.controller.startCapture('M', calibration)
    await flush()
    await vi.advanceTimersByTimeAsync(500 * 8)
    const state = h.controller.snapshot()
    expect(state.stats).toMatchObject({ captured: 9, pending: 2, skipped: 7 })
    h.controller.stop()
    const stopped = h.controller.snapshot()
    expect(stopped.stats.pending).toBe(0)
    expect(stopped.stats.captured).toBe(
      stopped.stats.processed + stopped.stats.failed + stopped.stats.skipped,
    )
    blocked.resolve(result())
    await flush()
    expect(h.controller.snapshot()).toBe(stopped)
    expect(h.capture.dispose).toHaveBeenCalledOnce()
  })
  it('остановка во время выбора экрана исключает поздний старт', async () => {
    const prompt = deferred<void>(),
      h = setup({}, { start: () => prompt.promise })
    const pending = h.controller.startCapture('M', calibration)
    h.controller.stop()
    prompt.resolve()
    await pending
    expect(h.engine.ready).not.toHaveBeenCalled()
    expect(h.controller.snapshot().phase).toBe('stopped')
    expect(h.capture.dispose).toHaveBeenCalledOnce()
  })
  it('отклоняет повторный запуск диалога захвата', async () => {
    const prompt = deferred<void>(),
      h = setup({}, { start: vi.fn(() => prompt.promise) })
    const pending = h.controller.startCapture('F', calibration)
    await h.controller.startCapture('F', calibration)
    expect(h.capture.start).toHaveBeenCalledOnce()
    h.controller.stop()
    prompt.resolve()
    await pending
  })
  it('показывает ошибку и освобождает ресурсы при сбое инициализации', async () => {
    const h = setup({ ready: () => Promise.reject(new Error('Ошибка OCR')) })
    await h.controller.startCapture('F', calibration)
    expect(h.controller.snapshot()).toMatchObject({ phase: 'error', error: 'Ошибка OCR' })
    expect(h.capture.dispose).toHaveBeenCalledOnce()
    expect(h.engine.dispose).toHaveBeenCalledOnce()
  })
  it('прекращает зависшую обработку по таймауту', async () => {
    vi.useFakeTimers()
    const blocked = deferred<void>(),
      h = setup({ ready: () => blocked.promise })
    const pending = h.controller.analyzeFile(image(), 'F', calibration)
    await vi.advanceTimersByTimeAsync(10_001)
    await pending
    expect(h.controller.snapshot().phase).toBe('error')
    expect(h.engine.dispose).toHaveBeenCalledOnce()
  })
  it('учитывает ошибку обработки без неверного процента', async () => {
    const h = setup({ analyze: () => Promise.reject(new Error('Повреждённый кадр')) })
    await h.controller.analyzeFile(image(), 'F', calibration)
    await flush()
    expect(h.controller.snapshot()).toMatchObject({
      phase: 'error',
      stats: { captured: 1, failed: 1, skipped: 0, pending: 0 },
    })
  })
  it('останавливается при завершении системного захвата', async () => {
    vi.useFakeTimers()
    let ended = () => {}
    const h = setup(
      {},
      {
        start: (_signal, onEnded) => {
          ended = onEnded
          return Promise.resolve()
        },
      },
    )
    await h.controller.startCapture('F', calibration)
    await flush()
    ended()
    expect(h.controller.snapshot().phase).toBe('stopped')
    expect(h.capture.dispose).toHaveBeenCalledOnce()
  })
  it('не публикует обновления после удаления компонента', async () => {
    const pending = deferred<AnalysisResult>(),
      h = setup({ analyze: () => pending.promise })
    await h.controller.analyzeFile(image(), 'F', calibration)
    h.controller.dispose()
    const count = h.onChange.mock.calls.length
    pending.resolve(result())
    await flush()
    await h.controller.analyzeFile(image(), 'F', calibration)
    expect(h.onChange).toHaveBeenCalledTimes(count)
    expect(h.engine.dispose).toHaveBeenCalledOnce()
  })
  it('безопасно завершает неактивную сессию', () => {
    const h = setup()
    expect(h.controller.snapshot()).toEqual(initialState())
    h.controller.stop()
    h.controller.stop()
    h.controller.dispose()
    h.controller.stop()
    expect(h.engine.dispose).not.toHaveBeenCalled()
  })
  it('проверяет формат и размер входного файла', async () => {
    expect(() => validateImageFile(image())).not.toThrow()
    expect(() => validateImageFile(new File([], 'empty.png', { type: 'image/png' }))).toThrow()
    expect(() =>
      validateImageFile(new File(['x'], 'file.svg', { type: 'image/svg+xml' })),
    ).toThrow()
    const oversized = image()
    Object.defineProperty(oversized, 'size', { value: MAX_FILE_BYTES + 1 })
    expect(() => validateImageFile(oversized)).toThrow()
    const h = setup()
    await h.controller.analyzeFile(oversized, 'F', calibration)
    expect(h.engine.ready).not.toHaveBeenCalled()
    expect(h.controller.snapshot().phase).toBe('error')
  })
})
