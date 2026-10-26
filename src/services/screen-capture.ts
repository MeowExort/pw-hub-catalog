import { abortError, throwIfAborted } from './abort.ts'
import { MAX_PIXELS } from '../imaging/segmentation.ts'

export interface CaptureSource {
  start: (signal: AbortSignal, onEnded: () => void) => Promise<void>
  frame: (signal: AbortSignal) => Promise<Blob>
  dispose: () => void
}
export class ScreenCapture implements CaptureSource {
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private stream: MediaStream | null = null
  private track: MediaStreamTrack | null = null
  private onEnded: (() => void) | null = null
  private disposed = false

  async start(signal: AbortSignal, onEnded: () => void): Promise<void> {
    if (!navigator.mediaDevices?.getDisplayMedia)
      throw new Error(
        'Захват экрана недоступен. Откройте приложение на localhost в Chrome или Edge либо загрузите файл.',
      )
    throwIfAborted(signal)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2 },
        audio: false,
      })
      if (this.disposed || signal.aborted) {
        stream.getTracks().forEach((track) => track.stop())
        throw abortError()
      }
      this.stream = stream
      this.track = stream.getVideoTracks()[0] ?? null
      if (!this.track) throw new Error('Источник не содержит видеопотока')
      this.onEnded = onEnded
      this.track.addEventListener('ended', onEnded, { once: true })
      this.video = document.createElement('video')
      this.video.muted = true
      this.video.playsInline = true
      this.video.srcObject = stream
      await this.video.play()
      throwIfAborted(signal)
      this.canvas = document.createElement('canvas')
    } catch (error) {
      this.dispose()
      throw error
    }
  }
  async frame(signal: AbortSignal): Promise<Blob> {
    throwIfAborted(signal)
    const video = this.video,
      canvas = this.canvas
    if (!video || !canvas || this.disposed) return Promise.reject(abortError())
    const width = video.videoWidth,
      height = video.videoHeight
    if (!width || !height) return Promise.reject(new Error('Кадр пока недоступен'))
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)))
    canvas.width = Math.floor(width * scale)
    canvas.height = Math.floor(height * scale)
    const context = canvas.getContext('2d')
    if (!context) return Promise.reject(new Error('Не удалось подготовить кадр'))
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (this.disposed || signal.aborted) reject(abortError())
        else if (blob) resolve(blob)
        else reject(new Error('Не удалось получить изображение кадра'))
      }, 'image/png')
    })
  }
  dispose(): void {
    this.disposed = true
    if (this.track && this.onEnded) this.track.removeEventListener('ended', this.onEnded)
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.video) {
      this.video.pause()
      this.video.srcObject = null
    }
    this.stream = null
    this.track = null
    this.video = null
    this.canvas = null
    this.onEnded = null
  }
}
