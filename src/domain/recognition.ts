import { DEFAULT_MATCH_POLICY } from './model.ts'
import type {
  CatalogStyle,
  MatchPolicy,
  NameMatch,
  Observation,
  ProgressReading,
  TextReading,
} from './model.ts'

export function normalizeName(text: string): string {
  return text
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/\*/g, '★')
    .replace(/[^\p{L}\p{N}★]/gu, '')
}
export function levenshtein(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (next[j - 1] ?? 0) + 1,
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    row = next
  }
  return row[b.length] ?? a.length
}
export function matchName(
  text: string,
  confidence: number,
  styles: readonly CatalogStyle[],
  policy: Readonly<MatchPolicy> = DEFAULT_MATCH_POLICY,
): NameMatch {
  const clean = normalizeName(text)
  if (!clean) return { kind: 'unknown', reason: 'empty', candidate: null, distance: null }
  const ranked = styles
    .map((style) => {
      const name = normalizeName(style.name)
      const starPenalty = name.includes('★') !== clean.includes('★') ? 1 : 0
      return {
        style,
        distance: levenshtein(clean, name) / Math.max(clean.length, name.length, 1) + starPenalty,
      }
    })
    .sort((a, b) => a.distance - b.distance)
  const first = ranked[0]
  if (!first) return { kind: 'unknown', reason: 'distance', candidate: null, distance: null }
  const unknown = (reason: 'confidence' | 'distance' | 'ambiguous'): NameMatch => ({
    kind: 'unknown',
    reason,
    candidate: first.style.name,
    distance: first.distance,
  })
  if (!Number.isFinite(confidence) || confidence < policy.minConfidence)
    return unknown('confidence')
  if (first.distance > policy.maxDistance) return unknown('distance')
  const margin = (ranked[1]?.distance ?? 1) - first.distance
  if (margin < policy.minMargin) return unknown('ambiguous')
  return { kind: 'matched', style: first.style, distance: first.distance, margin }
}
export function readProgress(raw: string, confidence: number): ProgressReading {
  const unknown: ProgressReading = {
    status: 'unknown',
    current: null,
    total: null,
    raw,
    confidence,
  }
  if (!Number.isFinite(confidence) || confidence < 50) return unknown
  const match = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(raw)
  if (!match) return unknown
  const current = Number(match[1]),
    total = Number(match[2])
  if (total < 1 || total > 20 || current > total) return unknown
  return {
    status: current === total ? 'collected' : 'not-collected',
    current,
    total,
    raw,
    confidence,
  }
}
export function chooseNameReading(
  readings: readonly TextReading[],
  styles: readonly CatalogStyle[],
): { reading: TextReading; match: NameMatch } {
  const ranked = readings
    .map((reading) => ({ reading, match: matchName(reading.text, reading.confidence, styles) }))
    .sort((a, b) => b.reading.confidence - a.reading.confidence)
  const accepted = ranked.filter((item) => item.match.kind === 'matched')
  const identities = new Set(
    accepted.map((item) => (item.match.kind === 'matched' ? item.match.style.id : '')),
  )
  const best = accepted[0] ??
    ranked[0] ?? { reading: { text: '', confidence: 0 }, match: matchName('', 0, styles) }
  if (identities.size > 1)
    return {
      reading: best.reading,
      match: { kind: 'unknown', reason: 'ambiguous', candidate: null, distance: null },
    }
  return best
}
export function chooseProgressReading(readings: readonly TextReading[]): ProgressReading {
  const ranked = readings
    .map((reading) => readProgress(reading.text, reading.confidence))
    .sort((a, b) => b.confidence - a.confidence)
  const accepted = ranked.filter((item) => item.status !== 'unknown')
  const values = new Set(accepted.map((item) => `${item.current}/${item.total}`))
  if (values.size > 1)
    return { ...readProgress('', 0), raw: accepted.map((item) => item.raw).join(' | ') }
  return accepted[0] ?? ranked[0] ?? readProgress('', 0)
}
export const MAX_OBSERVATIONS = 120
export function mergeObservations(
  existing: readonly Observation[],
  incoming: readonly Observation[],
): Observation[] {
  const map = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) {
    const previous = map.get(item.id)
    if (!previous) {
      map.set(item.id, item)
      continue
    }
    const quality = (v: Observation) =>
      v.nameConfidence - (v.match.kind === 'matched' ? v.match.distance * 100 : 100)
    const preferred = quality(item) >= quality(previous) ? item : previous
    const progress =
      item.progress.status !== 'unknown' &&
      (previous.progress.status === 'unknown' ||
        item.progress.confidence >= previous.progress.confidence)
        ? item.progress
        : previous.progress
    map.set(item.id, { ...preferred, progress, observedAt: item.observedAt })
  }
  return [...map.values()]
    .sort(
      (a, b) =>
        Number(b.match.kind === 'matched') - Number(a.match.kind === 'matched') ||
        b.observedAt - a.observedAt,
    )
    .slice(0, MAX_OBSERVATIONS)
}
