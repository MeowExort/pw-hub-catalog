export type Gender = 'F' | 'M'
export type CollectionStatus = 'collected' | 'not-collected' | 'unknown'
export type SourceType = 'SHOP_GOLD' | 'FAIR_GOLD' | 'GIFT_COINS'
export interface PriceSource {
  type: SourceType
  price: number
}
export interface CatalogStyle {
  id: string
  name: string
  gender: Gender
  sources: readonly PriceSource[]
}
export interface Rates {
  auction_gold_to_yuan: number
  ancient_coin_to_fair_gold_rate: number
  ancient_coin_to_yuan: number
}
export interface MatchPolicy {
  minConfidence: number
  maxDistance: number
  minMargin: number
}
export interface TextReading {
  text: string
  confidence: number
}
export const DEFAULT_MATCH_POLICY: Readonly<MatchPolicy> = {
  minConfidence: 30,
  maxDistance: 0.18,
  minMargin: 0.06,
}
export type NameMatch =
  | { kind: 'matched'; style: CatalogStyle; distance: number; margin: number }
  | {
      kind: 'unknown'
      reason: 'empty' | 'confidence' | 'distance' | 'ambiguous'
      candidate: string | null
      distance: number | null
    }
export interface ProgressReading {
  status: CollectionStatus
  current: number | null
  total: number | null
  raw: string
  confidence: number
}
export interface Observation {
  id: string
  match: NameMatch
  rawName: string
  nameConfidence: number
  progress: ProgressReading
  preview: Blob
  observedAt: number
}
export interface Diagnostics {
  fingerprint: string
  segmentationMs: number
  ocrMs: number
  totalMs: number
  workerCount: number
  warnings: string[]
}
export interface AnalysisResult {
  observations: Observation[]
  duplicate: boolean
  diagnostics: Diagnostics
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка обработки'
}
export function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(typeof error === 'string' ? error : errorMessage(error), { cause: error })
}
