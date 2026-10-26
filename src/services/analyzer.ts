import { catalogFor } from '../data/catalog.ts'
import { chooseNameReading, chooseProgressReading } from '../domain/recognition.ts'
import type { AnalysisResult, Gender } from '../domain/model.ts'
import type { Calibration } from '../imaging/segmentation.ts'
import { MAX_CARDS } from '../imaging/segmentation.ts'
import { ImageProcessor } from './image-processor.ts'
import { localWorkerFactory, OcrPool } from './ocr-pool.ts'
import { throwIfAborted } from './abort.ts'

export interface AnalysisEngine {
  ready: (signal: AbortSignal) => Promise<void>
  analyze: (
    image: Blob,
    gender: Gender,
    calibration: Calibration,
    signal: AbortSignal,
  ) => Promise<AnalysisResult>
  dispose: () => void
}
export class Analyzer implements AnalysisEngine {
  private processor = new ImageProcessor()
  private pool: OcrPool
  private previousFingerprint: string | null = null

  constructor() {
    this.pool = new OcrPool(
      localWorkerFactory(new URL(import.meta.env.BASE_URL, location.href).href),
      navigator.hardwareConcurrency || 2,
    )
  }
  ready(signal: AbortSignal): Promise<void> {
    return this.pool.ready(signal)
  }
  async analyze(
    image: Blob,
    gender: Gender,
    calibration: Calibration,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const start = performance.now()
    const prepared = await this.processor.prepare(
      image,
      calibration,
      this.previousFingerprint,
      signal,
    )
    throwIfAborted(signal)
    const warnings: string[] = []
    if (prepared.cards.length === MAX_CARDS)
      warnings.push(
        `Достигнут лимит ${MAX_CARDS} карточек в кадре. Захватите меньшую область, чтобы проверить остальные.`,
      )
    if (!prepared.cards.length && !prepared.duplicate)
      warnings.push(
        'Карточки не найдены. Выберите область каталога или задайте ширину карточки в калибровке.',
      )
    const ocrStart = performance.now()
    const texts = await this.pool.recognize(
      prepared.cards.flatMap((card) => [
        ...card.names.map((image) => ({ image, kind: 'name' as const })),
        ...card.progresses.map((image) => ({ image, kind: 'progress' as const })),
      ]),
      signal,
    )
    throwIfAborted(signal)
    let cursor = 0
    const observations = prepared.cards.map((card, i) => {
      const nameTexts = texts.slice(cursor, (cursor += card.names.length))
      const progressTexts = texts.slice(cursor, (cursor += card.progresses.length))
      if (nameTexts.length !== card.names.length || progressTexts.length !== card.progresses.length)
        throw new Error('OCR вернул неполный результат')
      const { reading: name, match } = chooseNameReading(nameTexts, catalogFor(gender))
      return {
        id: match.kind === 'matched' ? match.style.id : `unknown:${prepared.fingerprint}:${i}`,
        match,
        rawName: name.text,
        nameConfidence: name.confidence,
        progress: chooseProgressReading(progressTexts),
        preview: card.preview,
        observedAt: Date.now(),
      }
    })
    this.previousFingerprint = prepared.fingerprint
    return {
      observations,
      duplicate: prepared.duplicate,
      diagnostics: {
        fingerprint: prepared.fingerprint,
        segmentationMs: prepared.durationMs,
        ocrMs: performance.now() - ocrStart,
        totalMs: performance.now() - start,
        workerCount: this.pool.count,
        warnings,
      },
    }
  }
  dispose(): void {
    this.processor.dispose()
    this.pool.dispose()
  }
}
