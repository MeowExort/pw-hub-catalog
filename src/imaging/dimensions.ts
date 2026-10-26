import { validateRasterSize } from './segmentation.ts'

const invalidImage = () =>
  new Error('Не удалось прочитать изображение. Проверьте формат и целостность файла.')
const text = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))
export function readRasterDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const checked = (width: number, height: number) => {
    validateRasterSize(width, height)
    return { width, height }
  }
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    text(bytes, 1, 7) === 'PNG\r\n\u001a\n' &&
    text(bytes, 12, 4) === 'IHDR'
  ) {
    return checked(view.getUint32(16), view.getUint32(20))
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) throw invalidImage()
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++] ?? 0
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) throw invalidImage()
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (length < 7) throw invalidImage()
        return checked(view.getUint16(offset + 5), view.getUint16(offset + 3))
      }
      offset += length
    }
  }
  if (bytes.length >= 20 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') {
    const chunk = text(bytes, 12, 4)
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const uint24 = (offset: number) =>
        (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
      return checked(uint24(24) + 1, uint24(27) + 1)
    }
    if (
      chunk === 'VP8 ' &&
      bytes.length >= 30 &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    )
      return checked(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383)
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 47) {
      const bits = view.getUint32(21, true)
      return checked((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1)
    }
  }
  throw invalidImage()
}
export async function validateImageDimensions(image: Blob): Promise<void> {
  const header = new Uint8Array(await image.slice(0, 64).arrayBuffer())
  const bytes =
    header[0] === 255 && header[1] === 216 ? new Uint8Array(await image.arrayBuffer()) : header
  readRasterDimensions(bytes)
}
