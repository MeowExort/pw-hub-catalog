// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlobImage } from '../src/ui/blob-image.tsx'
import { ScreenCapture } from '../src/services/screen-capture.ts'
import { useCatalogSession } from '../src/session/use-catalog-session.ts'
import { DEFAULT_CALIBRATION } from '../src/imaging/segmentation.ts'
import { deferred, flush, result } from './helpers.ts'

const mocks = vi.hoisted(() => ({ constructed: vi.fn(), disposed: vi.fn() }))
vi.mock('../src/services/analyzer.ts', () => ({
  Analyzer: class {
    constructor() {
      mocks.constructed()
    }
    ready = async () => {}
    analyze = () => Promise.resolve(result())
    dispose = mocks.disposed
  },
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mocks.constructed.mockClear()
  mocks.disposed.mockClear()
})
describe('Владение ресурсами интерфейса', () => {
  it('освобождает URL при смене изображения, StrictMode и размонтировании', () => {
    let id = 0
    const live = new Set<string>(),
      create = vi.fn(() => {
        const url = `blob:test-${++id}`
        live.add(url)
        return url
      })
    const revoke = vi.fn((url: string) => live.delete(url))
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }),
    )
    const first = new Blob(['a']),
      second = new Blob(['b'])
    const view = render(
      <StrictMode>
        <BlobImage blob={first} alt="Карточка" />
      </StrictMode>,
    )
    expect(live.size).toBe(1)
    view.rerender(
      <StrictMode>
        <BlobImage blob={second} alt="Карточка" />
      </StrictMode>,
    )
    expect(live.size).toBe(1)
    view.unmount()
    expect(live.size).toBe(0)
    expect(create.mock.calls.length).toBe(revoke.mock.calls.length)
  })
  it('не создаёт OCR при монтировании StrictMode и завершает сессию', async () => {
    const hook = renderHook(useCatalogSession, { wrapper: StrictMode })
    expect(mocks.constructed).not.toHaveBeenCalled()
    await act(async () => {
      await hook.result.current.analyzeFile(
        new File(['x'], 'card.png', { type: 'image/png' }),
        'F',
        { ...DEFAULT_CALIBRATION },
      )
      await flush()
    })
    expect(mocks.constructed).toHaveBeenCalledOnce()
    expect(hook.result.current.state.phase).toBe('stopped')
    hook.unmount()
    expect(mocks.disposed).toHaveBeenCalledOnce()
  })
})
describe('Захват экрана', () => {
  function media() {
    const track = { stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream
    const getDisplayMedia = vi.fn(() => Promise.resolve(stream))
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia },
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    return { track, stream, getDisplayMedia }
  }
  it('останавливает полученный поток при ошибке video.play', async () => {
    const { track } = media()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(
      new Error('Сбой воспроизведения'),
    )
    const capture = new ScreenCapture()
    await expect(capture.start(new AbortController().signal, vi.fn())).rejects.toThrow(
      'Сбой воспроизведения',
    )
    expect(track.stop).toHaveBeenCalledOnce()
    capture.dispose()
    expect(track.stop).toHaveBeenCalledOnce()
  })
  it('останавливает поток, полученный после отмены диалога', async () => {
    const { track, stream, getDisplayMedia } = media(),
      late = deferred<MediaStream>()
    getDisplayMedia.mockReturnValueOnce(late.promise)
    const capture = new ScreenCapture(),
      signal = new AbortController().signal
    const starting = capture.start(signal, vi.fn())
    capture.dispose()
    late.resolve(stream)
    await expect(starting).rejects.toMatchObject({ name: 'AbortError' })
    expect(track.stop).toHaveBeenCalledOnce()
  })
  it('удаляет обработчик ended и очищает media при остановке', async () => {
    const { track } = media(),
      ended = vi.fn(),
      capture = new ScreenCapture()
    await capture.start(new AbortController().signal, ended)
    capture.dispose()
    expect(track.removeEventListener).toHaveBeenCalledWith('ended', ended)
    expect(track.stop).toHaveBeenCalledOnce()
    await expect(capture.frame(new AbortController().signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
  it('сообщает о неподдерживаемом API', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    await expect(new ScreenCapture().start(new AbortController().signal, vi.fn())).rejects.toThrow(
      'недоступен',
    )
  })
  it('проверяет готовность размеров кадра', async () => {
    media()
    const capture = new ScreenCapture()
    await capture.start(new AbortController().signal, vi.fn())
    await expect(capture.frame(new AbortController().signal)).rejects.toThrow(
      'Кадр пока недоступен',
    )
    capture.dispose()
  })
  it('проверяет получение blob и игнорирует callback после отмены', async () => {
    media()
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(148)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(180)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    let finish: BlobCallback = () => {}
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      finish = callback
    })
    const capture = new ScreenCapture(),
      controller = new AbortController()
    await capture.start(controller.signal, vi.fn())
    const first = capture.frame(controller.signal)
    finish(new Blob(['x']))
    expect(await first).toBeInstanceOf(Blob)
    const empty = capture.frame(controller.signal)
    finish(null)
    await expect(empty).rejects.toThrow('Не удалось получить')
    const late = capture.frame(controller.signal)
    controller.abort()
    capture.dispose()
    finish(new Blob(['x']))
    await expect(late).rejects.toMatchObject({ name: 'AbortError' })
  })
})
