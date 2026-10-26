import { describe, expect, it } from 'vitest'
import { prepareTextRaster } from '../src/imaging/preprocessing.ts'

describe('Подготовка текста', () => {
  it('превращает однородный фон в белый и не изменяет входной буфер', () => {
    const data = new Uint8ClampedArray(16).fill(70)
    const result = prepareTextRaster({ width: 2, height: 2, data }, 4, 120)
    expect(result).toMatchObject({ width: 4, height: 4 })
    expect([...result.data].every((value) => value === 255)).toBe(true)
    expect(data[0]).toBe(70)
  })
  it('сохраняет тёмный текст на светлом фоне и инвертирует светлый текст', () => {
    const light = new Uint8ClampedArray(3 * 3 * 4).fill(255)
    light[16] = 0
    light[17] = 0
    light[18] = 0
    const dark = new Uint8ClampedArray(light.map((v, i) => (i % 4 === 3 ? 255 : 255 - v)))
    for (const data of [light, dark]) {
      const result = prepareTextRaster({ width: 3, height: 3, data }, 3, null)
      expect(result.data[0]).toBe(255)
      expect(result.data[16]).toBe(0)
      expect(result.data[19]).toBe(255)
    }
  })
  it('проверяет буфер, размеры и порог', () => {
    const raster = { width: 2, height: 2, data: new Uint8ClampedArray(16) }
    expect(() => prepareTextRaster(raster, 0, 120)).toThrow()
    expect(() => prepareTextRaster(raster, 2048, 120)).toThrow()
    expect(() => prepareTextRaster(raster, 2, 300)).toThrow()
    expect(() =>
      prepareTextRaster({ ...raster, data: new Uint8ClampedArray(1) }, 2, null),
    ).toThrow()
  })
})
