export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Calibration {
  cardWidth: number | null
  tolerance: number
}
export const DEFAULT_CALIBRATION: Readonly<Calibration> = { cardWidth: null, tolerance: 24 }
export const MAX_PIXELS = 16_000_000
export const MAX_CARDS = 36
const BASE_WIDTH = 148,
  BASE_HEIGHT = 180

export function validateRasterSize(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_PIXELS
  ) {
    throw new Error('Изображение должно содержать от 1 до 16 миллионов пикселей')
  }
}
export function fingerprint({ width, height, data }: Raster): string {
  let a = 2166136261,
    b = 5381
  for (let i = 0; i < data.length; i += 4) {
    const value =
      ((data[i] ?? 0) << 24) |
      ((data[i + 1] ?? 0) << 16) |
      ((data[i + 2] ?? 0) << 8) |
      (data[i + 3] ?? 0)
    a = Math.imul(a ^ value, 16777619)
    b = Math.imul(b, 33) ^ value
  }
  return `${width}x${height}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
export function detectCards(
  raster: Raster,
  calibration: Readonly<Calibration> = DEFAULT_CALIBRATION,
): Rect[] {
  const { width, height, data } = raster
  validateRasterSize(width, height)
  if (data.length !== width * height * 4) throw new Error('Повреждённый буфер изображения')
  if (
    !Number.isFinite(calibration.tolerance) ||
    calibration.tolerance < 1 ||
    calibration.tolerance > 60 ||
    (calibration.cardWidth !== null &&
      (!Number.isFinite(calibration.cardWidth) ||
        calibration.cardWidth < 60 ||
        calibration.cardWidth > 600))
  ) {
    throw new Error('Некорректная калибровка изображения')
  }
  const ratio = width / height
  const singleCard =
    Math.abs(ratio - BASE_WIDTH / BASE_HEIGHT) < 0.055 && width >= 60 && width <= 600
  const mask = new Uint8Array(width * height)
  const distance = calibration.tolerance ** 2
  let matchedPixels = 0,
    minBrightness = 255,
    maxBrightness = 0
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4,
      r = data[i] ?? 0,
      g = data[i + 1] ?? 0,
      b = data[i + 2] ?? 0
    const brightness = (r + g + b) / 3
    minBrightness = Math.min(minBrightness, brightness)
    maxBrightness = Math.max(maxBrightness, brightness)
    if (
      (data[i + 3] ?? 0) >= 200 &&
      ((r - 70) ** 2 + (g - 77) ** 2 + (b - 112) ** 2 <= distance ||
        (r - 29) ** 2 + (g - 35) ** 2 + (b - 49) ** 2 <= distance)
    ) {
      mask[p] = 1
      matchedPixels++
    }
  }
  const stack = new Int32Array(width * height)
  const candidates: Rect[] = []
  for (let origin = 0; origin < mask.length; origin++) {
    if (mask[origin] !== 1) continue
    let length = 1,
      count = 0,
      minX = width,
      maxX = 0,
      minY = height,
      maxY = 0
    stack[0] = origin
    mask[origin] = 2
    while (length > 0) {
      const p = stack[--length] ?? 0
      const x = p % width,
        y = Math.floor(p / width)
      count++
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      if (x > 0 && mask[p - 1] === 1) {
        mask[p - 1] = 2
        stack[length++] = p - 1
      }
      if (x + 1 < width && mask[p + 1] === 1) {
        mask[p + 1] = 2
        stack[length++] = p + 1
      }
      if (y > 0 && mask[p - width] === 1) {
        mask[p - width] = 2
        stack[length++] = p - width
      }
      if (y + 1 < height && mask[p + width] === 1) {
        mask[p + width] = 2
        stack[length++] = p + width
      }
    }
    const componentWidth = maxX - minX + 1,
      componentHeight = maxY - minY + 1
    const cardWidth = calibration.cardWidth ?? componentWidth
    const cardHeight = Math.round((cardWidth * BASE_HEIGHT) / BASE_WIDTH)
    const density = count / (componentWidth * componentHeight)
    if (
      componentWidth < 60 ||
      componentWidth > 600 ||
      componentHeight < cardHeight * 0.45 ||
      componentHeight > cardHeight * 1.12 ||
      density < 0.15 ||
      count < cardWidth * cardHeight * 0.15
    )
      continue
    if (Math.abs(componentWidth - cardWidth) > cardWidth * 0.2) continue
    if (minX + cardWidth > width + 2 || minY + cardHeight > height + 2) continue
    candidates.push({
      x: minX,
      y: minY,
      width: Math.min(cardWidth, width - minX),
      height: Math.min(cardHeight, height - minY),
    })
  }
  const rects: Rect[] = []
  for (const candidate of candidates.sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (
      !rects.some(
        (r) =>
          candidate.x < r.x + r.width &&
          candidate.x + candidate.width > r.x &&
          candidate.y < r.y + r.height &&
          candidate.y + candidate.height > r.y,
      )
    )
      rects.push(candidate)
    if (rects.length === MAX_CARDS) break
  }
  if (
    singleCard &&
    rects.length <= 1 &&
    matchedPixels > width * height * 0.05 &&
    maxBrightness - minBrightness > 30
  )
    return [{ x: 0, y: 0, width, height }]
  return rects
}

export function normalizedRegion(card: Rect, region: Rect): Rect {
  const x = Math.round(card.x + region.x * card.width),
    y = Math.round(card.y + region.y * card.height)
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(region.width * card.width), card.x + card.width - x)),
    height: Math.max(
      1,
      Math.min(Math.round(region.height * card.height), card.y + card.height - y),
    ),
  }
}
export const NAME_REGION: Readonly<Rect> = { x: 0, y: 164 / 180, width: 1, height: 16 / 180 }
export const PROGRESS_REGION: Readonly<Rect> = {
  x: 112 / 148,
  y: 0,
  width: 34 / 148,
  height: 19 / 180,
}
