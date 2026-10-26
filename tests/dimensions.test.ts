import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { readRasterDimensions, validateImageDimensions } from '../src/imaging/dimensions.ts'
import { fixtureRoot } from '../scripts/fixtures.ts'

describe('Размеры до декодирования изображения', () => {
  it('читает настоящий PNG и отклоняет чрезмерный размер до создания bitmap', async () => {
    const bytes = new Uint8Array(await readFile(new URL('card.png', fixtureRoot)))
    expect(readRasterDimensions(bytes)).toEqual({ width: 148, height: 180 })
    await expect(validateImageDimensions(new Blob([bytes]))).resolves.toBeUndefined()
    new DataView(bytes.buffer).setUint32(16, 100_000)
    expect(() => readRasterDimensions(bytes)).toThrow('16 миллионов')
  })
  it('читает JPEG с сегментом метаданных и SOF', async () => {
    const bytes = new Uint8Array([
      255, 216, 255, 224, 0, 4, 0, 0, 255, 194, 0, 7, 8, 0, 180, 0, 148,
    ])
    expect(readRasterDimensions(bytes)).toEqual({ width: 148, height: 180 })
    await expect(validateImageDimensions(new Blob([bytes]))).resolves.toBeUndefined()
    bytes[4] = 255
    expect(() => readRasterDimensions(bytes)).toThrow()
  })
  it.each(['VP8X', 'VP8 ', 'VP8L'])('читает заголовок WebP %s', (format: string) => {
    const bytes = new Uint8Array(32),
      view = new DataView(bytes.buffer)
    const write = (offset: number, value: string) => {
      ;[...value].forEach((letter, i) => {
        bytes[offset + i] = letter.charCodeAt(0)
      })
    }
    write(0, 'RIFF')
    write(8, 'WEBP')
    write(12, format)
    if (format === 'VP8X') {
      bytes[24] = 147
      bytes[27] = 179
    }
    if (format === 'VP8 ') {
      bytes[23] = 157
      bytes[24] = 1
      bytes[25] = 42
      view.setUint16(26, 148, true)
      view.setUint16(28, 180, true)
    }
    if (format === 'VP8L') {
      bytes[20] = 47
      view.setUint32(21, 147 | (179 << 14), true)
    }
    expect(readRasterDimensions(bytes)).toEqual({ width: 148, height: 180 })
  })
  it('не принимает SVG, пустые и повреждённые заголовки', () => {
    for (const bytes of [
      new Uint8Array(),
      new TextEncoder().encode('<svg/>'),
      new Uint8Array([255, 216, 255, 218]),
    ])
      expect(() => readRasterDimensions(bytes)).toThrow('Не удалось прочитать')
  })
})
