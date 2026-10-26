import { prepareTextRaster } from './preprocessing.ts'
import { validateImageDimensions } from './dimensions.ts'
import {
  detectCards,
  fingerprint,
  NAME_REGION,
  normalizedRegion,
  PROGRESS_REGION,
  validateRasterSize,
} from './segmentation.ts'
import type { Rect } from './segmentation.ts'
import type { PreparedCard, PrepareRequest, PrepareResponse } from './protocol.ts'
import { errorMessage } from '../domain/model.ts'

function canvasFor(
  width: number,
  height: number,
): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Браузер не поддерживает обработку изображений в Worker')
  return { canvas, context }
}
async function crop(
  image: ImageBitmap,
  rect: Rect,
  mode: 'preview' | 'gray' | 'binary',
  threshold = 100,
  targetWidth = 444,
): Promise<Blob> {
  if (mode === 'preview') {
    const { canvas, context } = canvasFor(rect.width, rect.height)
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    return canvas.convertToBlob({ type: 'image/png' })
  }
  const body = canvasFor(444, Math.max(1, Math.round((rect.height * 444) / rect.width)))
  body.context.imageSmoothingQuality = 'high'
  body.context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    body.canvas.width,
    body.canvas.height,
  )
  const pixels = body.context.getImageData(0, 0, body.canvas.width, body.canvas.height)
  const prepared = prepareTextRaster(pixels, targetWidth, mode === 'binary' ? threshold : null)
  const padding = mode === 'binary' ? 8 : 0
  const { canvas, context } = canvasFor(prepared.width + padding * 2, prepared.height + padding * 2)
  context.fillStyle = 'white'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const output = context.createImageData(prepared.width, prepared.height)
  output.data.set(prepared.data)
  context.putImageData(output, padding, padding)
  return canvas.convertToBlob({ type: 'image/png' })
}
globalThis.onmessage = async (event: MessageEvent<PrepareRequest>) => {
  const { id, image, calibration, previousFingerprint } = event.data
  let bitmap: ImageBitmap | undefined
  try {
    const start = performance.now()
    if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function')
      throw new Error(
        'Браузер не поддерживает обработку изображений. Используйте актуальный Chrome или Edge.',
      )
    await validateImageDimensions(image)
    bitmap = await createImageBitmap(image).catch(() => {
      throw new Error('Не удалось прочитать изображение. Проверьте формат и целостность файла.')
    })
    validateRasterSize(bitmap.width, bitmap.height)
    const { context } = canvasFor(bitmap.width, bitmap.height)
    context.drawImage(bitmap, 0, 0)
    const raster = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const hash = fingerprint(raster)
    const cards: PreparedCard[] = []
    if (hash !== previousFingerprint) {
      for (const rect of detectCards(raster, calibration)) {
        const nameRect = normalizedRegion(rect, NAME_REGION),
          progressRect = normalizedRegion(rect, PROGRESS_REGION)
        const [names, progresses, preview] = await Promise.all([
          Promise.all([
            crop(bitmap, nameRect, 'gray'),
            crop(bitmap, nameRect, 'binary'),
            crop(bitmap, nameRect, 'binary', 120),
          ]),
          Promise.all([
            crop(bitmap, progressRect, 'gray', 100, 102),
            crop(bitmap, progressRect, 'gray', 100, 204),
            crop(bitmap, progressRect, 'binary', 120, 136),
          ]),
          crop(bitmap, rect, 'preview'),
        ])
        cards.push({ names, progresses, preview, rect })
      }
    }
    const response: PrepareResponse = {
      id,
      ok: true,
      frame: {
        cards,
        fingerprint: hash,
        duplicate: hash === previousFingerprint,
        durationMs: performance.now() - start,
      },
    }
    globalThis.postMessage(response)
  } catch (error) {
    const response: PrepareResponse = { id, ok: false, error: errorMessage(error) }
    globalThis.postMessage(response)
  } finally {
    bitmap?.close()
  }
}
