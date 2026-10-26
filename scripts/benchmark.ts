import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { detectCards, fingerprint } from '../src/imaging/segmentation.ts'
import { grid, originalCard, rasterFromPng } from './fixtures.ts'

const measurements = []
const card = await originalCard()
for (const [width, height, budgetMs] of [
  [1920, 1080, 1500],
  [3840, 2160, 4000],
]) {
  if (!width || !height || !budgetMs) throw new Error('Некорректные параметры измерения')
  const raster = rasterFromPng(grid(card, width, height))
  const times: number[] = []
  for (let i = 0; i < 7; i++) {
    const start = performance.now()
    const rects = detectCards(raster)
    fingerprint(raster)
    if (rects.length !== 9) throw new Error(`Ожидалось 9 карточек, найдено ${rects.length}`)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const p95Ms = times.at(-1) ?? Infinity
  measurements.push({
    width,
    height,
    iterations: times.length,
    medianMs: times[3],
    p95Ms,
    budgetMs,
    auxiliaryBufferBytes: width * height * 5,
  })
  if (p95Ms > budgetMs)
    throw new Error(`Превышен бюджет сегментации ${width}×${height}: ${p95Ms.toFixed(1)} мс`)
}
await mkdir('reports', { recursive: true })
await writeFile(
  'reports/segmentation.json',
  JSON.stringify({ runtime: process.version, platform: process.platform, measurements }, null, 2) +
    '\n',
)
console.table(measurements)
