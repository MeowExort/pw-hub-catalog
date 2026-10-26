import { validateRasterSize } from './segmentation.ts'
import type { Raster } from './segmentation.ts'

// Стабильная сетка пикселей сохраняет тонкие штрихи игрового шрифта при смене масштаба.
export function prepareTextRaster(
  raster: Raster,
  targetWidth: number,
  threshold: number | null,
): Raster {
  validateRasterSize(raster.width, raster.height)
  if (
    raster.data.length !== raster.width * raster.height * 4 ||
    !Number.isInteger(targetWidth) ||
    targetWidth < 1 ||
    targetWidth > 1024 ||
    (threshold !== null && (!Number.isFinite(threshold) || threshold < 0 || threshold > 255))
  ) {
    throw new Error('Некорректные параметры подготовки текста')
  }
  const data = new Uint8ClampedArray(raster.data)
  let min = 255,
    max = 0
  for (let i = 0; i < data.length; i += 4) {
    const gray = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3
    min = Math.min(min, gray)
    max = Math.max(max, gray)
    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray
    data[i + 3] = 255
  }
  const range = max - min
  const corners = [
    0,
    (raster.width - 1) * 4,
    (raster.height - 1) * raster.width * 4,
    (raster.width * raster.height - 1) * 4,
  ]
  const background = corners.reduce((sum, i) => sum + (data[i] ?? 0), 0) / corners.length
  for (let i = 0; i < data.length; i += 4) {
    let value = range > 10 ? (((data[i] ?? 0) - min) / range) * 255 : 255
    if (range > 10 && background < 160) value = 255 - value
    if (threshold !== null) value = value < threshold ? 0 : 255
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }
  const height = Math.max(1, Math.round((raster.height * targetWidth) / raster.width))
  validateRasterSize(targetWidth, height)
  const output = new Uint8ClampedArray(targetWidth * height * 4)
  const sourcePixels = new Uint32Array(data.buffer),
    destinationPixels = new Uint32Array(output.buffer)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < targetWidth; x++) {
      const source =
        Math.floor((y * raster.height) / height) * raster.width +
        Math.floor((x * raster.width) / targetWidth)
      destinationPixels[y * targetWidth + x] = sourcePixels[source] ?? 0
    }
  return { width: targetWidth, height, data: output }
}
