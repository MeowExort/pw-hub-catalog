import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import type { Raster } from '../src/imaging/segmentation.ts'

export const fixtureRoot = new URL('../tests/fixtures/', import.meta.url)
export interface FixtureLabel {
  file: string
  gender: 'F' | 'M'
  name: string | null
  status: 'collected' | 'not-collected' | 'unknown'
  progress?: string
  cards: number
  provenance: string
}
export const fixtureLabels: readonly FixtureLabel[] = [
  {
    file: 'card.png',
    gender: 'F',
    name: 'Костюм Вишневая дискотека',
    status: 'collected',
    cards: 1,
    provenance: 'Исходная карточка из проекта',
  },
  ...[1.25, 1.5, 2].map((scale) => ({
    file: `scaled-${scale}.png`,
    gender: 'F' as const,
    name: 'Костюм Вишневая дискотека',
    status: 'collected' as const,
    cards: 1,
    provenance: `Производная исходной карточки, масштаб ${scale}`,
  })),
  {
    file: 'unknown-progress.png',
    gender: 'F',
    name: 'Костюм Вишневая дискотека',
    status: 'unknown',
    cards: 1,
    provenance: 'Производная: счётчик закрашен',
  },
  {
    file: 'blank.png',
    gender: 'F',
    name: null,
    status: 'unknown',
    cards: 0,
    provenance: 'Синтетическое пустое изображение',
  },
  {
    file: 'noise.png',
    gender: 'F',
    name: null,
    status: 'unknown',
    cards: 0,
    provenance: 'Синтетический шум',
  },
  {
    file: 'name-only.png',
    gender: 'F',
    name: null,
    status: 'unknown',
    cards: 0,
    provenance: 'Исходный обрезанный фрагмент названия без карточки',
  },
  {
    file: 'male-catalog.png',
    gender: 'M',
    name: 'Костюм Вишневая дискотека',
    status: 'collected',
    cards: 1,
    provenance: 'Одноимённый стиль присутствует в обоих справочниках; проверяется мужская запись',
  },
  {
    file: 'unknown-name.png',
    gender: 'F',
    name: null,
    status: 'collected',
    cards: 1,
    provenance: 'Производная исходной карточки: название закрашено',
  },
  {
    file: 'grid.png',
    gender: 'F',
    name: 'Костюм Вишневая дискотека',
    status: 'collected',
    cards: 9,
    provenance: 'Синтетическая сетка из девяти копий исходной карточки',
  },
  {
    file: 'grid-4k.png',
    gender: 'F',
    name: 'Костюм Вишневая дискотека',
    status: 'collected',
    cards: 9,
    provenance: 'Синтетический кадр 3840×2160 с девятью копиями исходной карточки',
  },
]
export function rasterFromPng(png: PNG): Raster {
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}
export async function originalCard(): Promise<PNG> {
  return PNG.sync.read(await readFile(new URL('card.png', fixtureRoot)))
}
function blank(width: number, height: number): PNG {
  const png = new PNG({ width, height })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 12
    png.data[i + 1] = 16
    png.data[i + 2] = 22
    png.data[i + 3] = 255
  }
  return png
}
export function grid(card: PNG, width = 600, height = 620): PNG {
  const image = blank(width, height)
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++) {
      PNG.bitblt(
        card,
        image,
        0,
        0,
        card.width,
        card.height,
        20 + column * (card.width + 12),
        20 + row * (card.height + 12),
      )
    }
  return image
}
export async function generateFixtures(): Promise<void> {
  const target = new URL('generated/', fixtureRoot)
  await mkdir(target, { recursive: true })
  const card = await originalCard()
  await writeFile(new URL('card.png', target), PNG.sync.write(card))
  await writeFile(new URL('male-catalog.png', target), PNG.sync.write(card))
  await writeFile(
    new URL('name-only.png', target),
    await readFile(new URL('name.png', fixtureRoot)),
  )
  for (const scale of [1.25, 1.5, 2]) {
    const resized = new PNG({
      width: Math.round(card.width * scale),
      height: Math.round(card.height * scale),
    })
    for (let y = 0; y < resized.height; y++)
      for (let x = 0; x < resized.width; x++) {
        const source = (Math.floor(y / scale) * card.width + Math.floor(x / scale)) * 4,
          destination = (y * resized.width + x) * 4
        card.data.copy(resized.data, destination, source, source + 4)
      }
    await writeFile(new URL(`scaled-${scale}.png`, target), PNG.sync.write(resized))
  }
  const hidden = PNG.sync.read(PNG.sync.write(card))
  for (let y = 0; y < 19; y++)
    for (let x = 112; x < 148; x++) {
      const i = (y * hidden.width + x) * 4
      hidden.data[i] = 70
      hidden.data[i + 1] = 77
      hidden.data[i + 2] = 112
    }
  await writeFile(new URL('unknown-progress.png', target), PNG.sync.write(hidden))
  const hiddenName = PNG.sync.read(PNG.sync.write(card))
  for (let y = 164; y < 180; y++)
    for (let x = 0; x < 148; x++) {
      const i = (y * hiddenName.width + x) * 4
      hiddenName.data[i] = 70
      hiddenName.data[i + 1] = 77
      hiddenName.data[i + 2] = 112
    }
  await writeFile(new URL('unknown-name.png', target), PNG.sync.write(hiddenName))
  await writeFile(new URL('blank.png', target), PNG.sync.write(blank(640, 480)))
  const noise = blank(640, 480)
  let seed = 1234567
  for (let i = 0; i < noise.data.length; i += 4) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    noise.data[i] = seed & 255
    noise.data[i + 1] = (seed >>> 8) & 255
    noise.data[i + 2] = (seed >>> 16) & 255
  }
  await writeFile(new URL('noise.png', target), PNG.sync.write(noise))
  await writeFile(new URL('grid.png', target), PNG.sync.write(grid(card)))
  await writeFile(new URL('grid-4k.png', target), PNG.sync.write(grid(card, 3840, 2160)))
  await writeFile(new URL('labels.json', target), JSON.stringify(fixtureLabels, null, 2) + '\n')
}
