import type { AnalysisResult, CatalogStyle, Observation } from '../src/domain/model.ts'
export const style: CatalogStyle = {
  id: 'f-test',
  name: 'Костюм Вишневая дискотека',
  gender: 'F',
  sources: [],
}
export function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: style.id,
    match: { kind: 'matched', style, distance: 0, margin: 1 },
    rawName: style.name,
    nameConfidence: 90,
    progress: { status: 'collected', current: 5, total: 5, raw: '5/5', confidence: 95 },
    preview: new Blob(['card']),
    observedAt: 1,
    ...overrides,
  }
}
export function result(observations: Observation[] = [observation()]): AnalysisResult {
  return {
    observations,
    duplicate: false,
    diagnostics: {
      fingerprint: 'test',
      segmentationMs: 1,
      ocrMs: 2,
      totalMs: 3,
      workerCount: 2,
      warnings: [],
    },
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
export async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}
