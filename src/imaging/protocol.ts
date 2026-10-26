import type { Calibration, Rect } from './segmentation.ts'
export interface PreparedCard {
  names: Blob[]
  progresses: Blob[]
  preview: Blob
  rect: Rect
}
export interface PreparedFrame {
  cards: PreparedCard[]
  fingerprint: string
  duplicate: boolean
  durationMs: number
}
export interface PrepareRequest {
  id: number
  image: Blob
  calibration: Calibration
  previousFingerprint: string | null
}
export type PrepareResponse =
  { id: number; ok: true; frame: PreparedFrame } | { id: number; ok: false; error: string }
