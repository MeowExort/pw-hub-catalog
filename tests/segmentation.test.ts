import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import {
  DEFAULT_CALIBRATION,
  detectCards,
  fingerprint,
  MAX_CARDS,
  NAME_REGION,
  normalizedRegion,
  validateRasterSize,
} from '../src/imaging/segmentation.ts'
import {
  fixtureRoot,
  generateFixtures,
  grid,
  originalCard,
  rasterFromPng,
} from '../scripts/fixtures.ts'

beforeAll(generateFixtures, 30_000)
describe('Сегментация и калибровка', () => {
  it.each(['card.png', 'scaled-1.25.png', 'scaled-1.5.png', 'scaled-2.png'])(
    'находит одиночную карточку %s',
    async (file: string) => {
      const raster = rasterFromPng(
        PNG.sync.read(await readFile(new URL(`generated/${file}`, fixtureRoot))),
      )
      expect(detectCards(raster)).toEqual([
        { x: 0, y: 0, width: raster.width, height: raster.height },
      ])
    },
  )
  it('находит сетку вместо ошибочного выбора одной портретной карточки', async () => {
    const raster = rasterFromPng(grid(await originalCard()))
    expect(detectCards(raster)).toHaveLength(9)
    expect(detectCards(raster, { cardWidth: 148, tolerance: 24 })).toHaveLength(9)
    expect(detectCards(raster, { cardWidth: 296, tolerance: 24 })).toHaveLength(0)
  })
  it.each(['blank.png', 'noise.png', 'name-only.png'])(
    'не находит карточки в %s',
    async (file: string) => {
      const raster = rasterFromPng(
        PNG.sync.read(await readFile(new URL(`generated/${file}`, fixtureRoot))),
      )
      expect(detectCards(raster)).toHaveLength(0)
    },
  )
  it('отклоняет неверные размеры, буферы и калибровку', () => {
    expect(() => validateRasterSize(0, 1)).toThrow()
    expect(() => validateRasterSize(5000, 5000)).toThrow()
    expect(() => validateRasterSize(1.5, 100)).toThrow()
    const raster = { width: 4, height: 4, data: new Uint8ClampedArray(64) }
    expect(() => detectCards({ ...raster, data: new Uint8ClampedArray(1) })).toThrow()
    expect(() => detectCards(raster, { ...DEFAULT_CALIBRATION, tolerance: -1 })).toThrow()
    expect(() => detectCards(raster, { ...DEFAULT_CALIBRATION, cardWidth: NaN })).toThrow()
  })
  it('не определяет сбор по геометрии портретного изображения', () => {
    const raster = { width: 148, height: 180, data: new Uint8ClampedArray(148 * 180 * 4) }
    expect(detectCards(raster)).toHaveLength(0)
  })
  it('отпечаток меняется при изменении пикселя и размеров', () => {
    const raster = { width: 2, height: 2, data: new Uint8ClampedArray(16) }
    const original = fingerprint(raster)
    raster.data[0] = 1
    expect(fingerprint(raster)).not.toBe(original)
    expect(fingerprint({ ...raster, width: 4, height: 1 })).not.toBe(fingerprint(raster))
  })
  it('масштабирует область названия пропорционально карточке', () => {
    expect(normalizedRegion({ x: 10, y: 20, width: 296, height: 360 }, NAME_REGION)).toEqual({
      x: 10,
      y: 348,
      width: 296,
      height: 32,
    })
    expect(MAX_CARDS).toBe(36)
  })
})
