import { errorMessage } from '../domain/model.ts'
import type { Diagnostics, Gender, Observation } from '../domain/model.ts'
import { mergeObservations } from '../domain/recognition.ts'
import type { Calibration } from '../imaging/segmentation.ts'
import type { AnalysisEngine } from '../services/analyzer.ts'
import type { CaptureSource } from '../services/screen-capture.ts'
import { withAbort } from '../services/abort.ts'

export type SessionPhase =
  'idle' | 'starting' | 'loading' | 'capturing' | 'processing' | 'stopped' | 'error'
export interface SessionStats {
  captured: number
  processed: number
  skipped: number
  duplicates: number
  failed: number
  pending: number
}
export interface SessionState {
  phase: SessionPhase
  observations: readonly Observation[]
  stats: SessionStats
  preview: Blob | null
  diagnostics: Diagnostics | null
  error: string | null
}
export function initialState(): SessionState {
  return {
    phase: 'idle',
    observations: [],
    stats: { captured: 0, processed: 0, skipped: 0, duplicates: 0, failed: 0, pending: 0 },
    preview: null,
    diagnostics: null,
    error: null,
  }
}
interface Run {
  controller: AbortController
  engine: AnalysisEngine
  capture: CaptureSource | null
  gender: Gender
  calibration: Calibration
  queued: Blob | null
  processing: boolean
  timer: ReturnType<typeof setTimeout> | null
}
interface Dependencies {
  createEngine: () => AnalysisEngine
  createCapture: () => CaptureSource
  onChange: (state: SessionState) => void
  timeoutMs?: number
}
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export function validateImageFile(file: File): void {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Выберите изображение PNG, JPEG или WebP')
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new Error('Размер файла должен быть от 1 байта до 20 МБ')
}
async function deadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await withAbort(
      Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Превышено время ожидания обработки. Попробуйте ещё раз.')),
            timeoutMs,
          )
        }),
      ]),
      signal,
    )
  } finally {
    clearTimeout(timer)
  }
}
export class SessionController {
  private state = initialState()
  private active: Run | null = null
  private disposed = false
  private readonly dependencies: Dependencies
  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies
  }
  snapshot(): SessionState {
    return this.state
  }
  private current(run: Run): boolean {
    return !this.disposed && this.active === run && !run.controller.signal.aborted
  }
  private publish(patch: Partial<SessionState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    this.dependencies.onChange(this.state)
  }
  private begin(gender: Gender, calibration: Calibration): Run {
    this.cancelActive()
    this.state = initialState()
    const run: Run = {
      controller: new AbortController(),
      engine: this.dependencies.createEngine(),
      capture: null,
      gender,
      calibration: { ...calibration },
      queued: null,
      processing: false,
      timer: null,
    }
    this.active = run
    return run
  }
  async startCapture(gender: Gender, calibration: Calibration): Promise<void> {
    if (
      this.disposed ||
      this.state.phase === 'starting' ||
      this.state.phase === 'loading' ||
      this.state.phase === 'capturing'
    )
      return
    const run = this.begin(gender, calibration)
    this.publish({ phase: 'starting' })
    try {
      run.capture = this.dependencies.createCapture()
      await run.capture.start(run.controller.signal, () => {
        if (this.current(run)) this.stop()
      })
      if (!this.current(run)) return
      this.publish({ phase: 'loading' })
      await deadline(
        run.engine.ready(run.controller.signal),
        this.dependencies.timeoutMs ?? 45_000,
        run.controller.signal,
      )
      if (!this.current(run)) return
      this.publish({ phase: 'capturing' })
      void this.tick(run)
    } catch (error) {
      this.fail(run, error)
    }
  }
  async analyzeFile(file: File, gender: Gender, calibration: Calibration): Promise<void> {
    if (this.disposed) return
    const run = this.begin(gender, calibration)
    this.publish({ phase: 'loading' })
    try {
      validateImageFile(file)
      await deadline(
        run.engine.ready(run.controller.signal),
        this.dependencies.timeoutMs ?? 45_000,
        run.controller.signal,
      )
      if (this.current(run)) this.enqueue(run, file)
    } catch (error) {
      this.fail(run, error)
    }
  }
  private async tick(run: Run): Promise<void> {
    if (!this.current(run) || !run.capture) return
    try {
      const image = await run.capture.frame(run.controller.signal)
      if (this.current(run)) this.enqueue(run, image)
    } catch (error) {
      this.fail(run, error)
    }
    if (this.current(run))
      run.timer = setTimeout(() => {
        void this.tick(run)
      }, 500)
  }
  private enqueue(run: Run, image: Blob): void {
    if (!this.current(run)) return
    const replaced = run.queued !== null
    run.queued = image
    this.publish({
      preview: image,
      stats: {
        ...this.state.stats,
        captured: this.state.stats.captured + 1,
        skipped: this.state.stats.skipped + Number(replaced),
        pending: Number(run.processing) + 1,
      },
    })
    if (!run.processing) void this.drain(run)
  }
  private async drain(run: Run): Promise<void> {
    run.processing = true
    while (this.current(run) && run.queued) {
      const image = run.queued
      run.queued = null
      this.publish({
        phase: run.capture ? 'capturing' : 'processing',
        stats: { ...this.state.stats, pending: 1 },
      })
      try {
        const result = await deadline(
          run.engine.analyze(image, run.gender, run.calibration, run.controller.signal),
          this.dependencies.timeoutMs ?? 45_000,
          run.controller.signal,
        )
        if (!this.current(run)) return
        this.publish({
          observations: mergeObservations(this.state.observations, result.observations),
          diagnostics: result.diagnostics,
          error: null,
          stats: {
            ...this.state.stats,
            processed: this.state.stats.processed + 1,
            duplicates: this.state.stats.duplicates + Number(result.duplicate),
            pending: Number(run.queued !== null),
          },
        })
      } catch (error) {
        if (!this.current(run)) return
        this.publish({
          stats: {
            ...this.state.stats,
            failed: this.state.stats.failed + 1,
            pending: Number(run.queued !== null),
          },
        })
        run.processing = false
        this.fail(run, error)
        return
      }
    }
    run.processing = false
    if (this.current(run) && !run.capture) {
      this.cancelActive()
      this.publish({ phase: 'stopped', stats: { ...this.state.stats, pending: 0 } })
    }
  }
  private fail(run: Run, error: unknown): void {
    if (!this.current(run)) return
    const pending = Number(run.processing) + Number(run.queued !== null)
    this.cancelActive()
    this.publish({
      phase: 'error',
      error: errorMessage(error),
      stats: { ...this.state.stats, skipped: this.state.stats.skipped + pending, pending: 0 },
    })
  }
  private cancelActive(): void {
    const run = this.active
    if (!run) return
    this.active = null
    run.controller.abort()
    clearTimeout(run.timer ?? undefined)
    run.capture?.dispose()
    run.engine.dispose()
    run.queued = null
  }
  stop(): void {
    const pending = this.state.stats.pending
    this.cancelActive()
    this.publish({
      phase: 'stopped',
      stats: { ...this.state.stats, skipped: this.state.stats.skipped + pending, pending: 0 },
    })
  }
  dispose(): void {
    this.disposed = true
    this.cancelActive()
  }
}
