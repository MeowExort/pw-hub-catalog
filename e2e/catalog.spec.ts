import { test, expect } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { fixtureLabels, fixtureRoot } from '../scripts/fixtures.ts'
import type { FixtureLabel } from '../scripts/fixtures.ts'
interface Measurement {
  fixture: FixtureLabel
  elapsedMs: number
  diagnostic: string
  evidence: string[]
  mainThreadLongTasksMs?: number[]
  observed: { name: string; status: string }[]
}
const measurements: Measurement[] = []

declare global {
  interface Window {
    __resources: { urls: number; workers: number; longTasks: number[] }
    __stream: MediaStream | undefined
  }
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__resources = { urls: 0, workers: 0, longTasks: [] }
    new PerformanceObserver((list) => {
      window.__resources.longTasks.push(...list.getEntries().map((entry) => entry.duration))
    }).observe({ type: 'longtask', buffered: true })
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL)
    const urls = new Set<string>()
    URL.createObjectURL = (blob) => {
      const url = create(blob)
      urls.add(url)
      window.__resources.urls = urls.size
      return url
    }
    URL.revokeObjectURL = (url) => {
      urls.delete(url)
      window.__resources.urls = urls.size
      revoke(url)
    }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      private active = true
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args)
        window.__resources.workers++
      }
      override terminate(): void {
        if (this.active) {
          this.active = false
          window.__resources.workers--
        }
        super.terminate()
      }
    }
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1')
      throw new Error(`Неожиданный внешний запрос: ${url.href}`)
    await route.continue()
  })
})

for (const label of fixtureLabels) {
  test(`Реальный OCR: ${label.file} (${label.gender})`, async ({ page }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await page
      .getByRole('radio', { name: label.gender === 'F' ? 'Женский' : 'Мужской', exact: true })
      .check()
    await page.getByRole('checkbox', { name: 'Диагностика', exact: true }).check()
    const started = Date.now()
    await page
      .getByLabel('Загрузить скриншот', { exact: true })
      .setInputFiles(fileURLToPath(new URL(`generated/${label.file}`, fixtureRoot)))
    await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
    const cards = page.locator('article.observation')
    const measurement: Measurement = {
      fixture: label,
      elapsedMs: Date.now() - started,
      diagnostic: await page.getByRole('region', { name: 'Диагностика', exact: true }).innerText(),
      evidence: await cards.locator('.diagnostic').allTextContents(),
      mainThreadLongTasksMs: await page.evaluate(() => window.__resources.longTasks),
      observed: await cards.evaluateAll((elements) =>
        elements.map((element) => ({
          name: element.querySelector('h3')?.textContent ?? '',
          status: element.querySelector('.badge')?.textContent ?? '',
        })),
      ),
    }
    measurements.push(measurement)
    if (label.file === 'grid-4k.png')
      expect(Math.max(0, ...(measurement.mainThreadLongTasksMs ?? []))).toBeLessThan(1000)
    if (label.name)
      await expect(cards.getByRole('heading', { name: label.name, exact: true })).toBeVisible({
        timeout: 1000,
      })
    else if (label.cards)
      await expect(
        cards.getByRole('heading', { name: 'Название не распознано', exact: true }),
      ).toBeVisible({ timeout: 1000 })
    else await expect(cards).toHaveCount(0)
    if (label.cards)
      await expect(cards.locator('.badge')).toContainText(
        label.status === 'collected' ? 'Собран · 5/5' : 'Сбор не определён',
        { timeout: 1000 },
      )
    await expect.poll(() => page.evaluate(() => window.__resources.workers)).toBe(0)
    if (label.gender === 'M' && label.name)
      await expect(cards.getByText('Мужской стиль', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
    await info.attach('ocr-result', {
      body: JSON.stringify(measurement, null, 2),
      contentType: 'application/json',
    })
    await mkdir('reports/ocr', { recursive: true })
    await writeFile(`reports/ocr/${label.file}.json`, JSON.stringify(measurement, null, 2) + '\n')
  })
}

test('Повторная загрузка освобождает URL и работников, фильтры работают', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: 'Женский', exact: true }).check()
  for (let i = 0; i < 4; i++) {
    await page
      .getByLabel('Загрузить скриншот', { exact: true })
      .setInputFiles(fileURLToPath(new URL('card.png', fixtureRoot)))
    await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
    await expect.poll(() => page.evaluate(() => window.__resources.workers)).toBe(0)
    await expect.poll(() => page.evaluate(() => window.__resources.urls)).toBe(1)
  }
  await page.getByLabel('Показать', { exact: true }).selectOption('not-collected')
  await expect(page.locator('article.observation')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__resources.urls)).toBe(0)
  await page.getByLabel('Показать', { exact: true }).selectOption('all')
  await expect(page.locator('article.observation')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.__resources.urls)).toBe(1)
})

test('Захват, переключение диагностики, пропуск одинаковых кадров и остановка', async ({
  page,
}) => {
  const base64 = (await readFile(new URL('card.png', fixtureRoot))).toString('base64')
  await page.addInitScript((base64) => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        canvas.getContext('2d')?.drawImage(image, 0, 0)
        window.__stream = canvas.captureStream(2)
        return window.__stream
      },
    })
  }, base64)
  await page.goto('/')
  await page.getByRole('radio', { name: 'Женский', exact: true }).check()
  await page.getByRole('button', { name: 'Начать захват', exact: true }).click()
  await expect(page.locator('article.observation h3')).toHaveText('Костюм Вишневая дискотека')
  await page.getByRole('checkbox', { name: 'Диагностика', exact: true }).check()
  await expect(page.getByRole('region', { name: 'Диагностика', exact: true })).toBeVisible()
  await expect(page.locator('.statistics')).toContainText(/Повторов: [1-9]/)
  await page.getByRole('button', { name: 'Остановить', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
  await expect.poll(() => page.evaluate(() => window.__resources.workers)).toBe(0)
  expect(
    await page.evaluate(() =>
      window.__stream?.getTracks().every((track) => track.readyState === 'ended'),
    ),
  ).toBe(true)
  await page.getByRole('checkbox', { name: 'Диагностика', exact: true }).uncheck()
  await expect.poll(() => page.evaluate(() => window.__resources.urls)).toBe(1)
})

test('Отмена во время загрузки OCR завершает поздно созданных работников', async ({ page }) => {
  await page.route('http://127.0.0.1:5101/ocr/*.traineddata', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await route.continue()
  })
  await page.goto('/')
  await page.getByRole('radio', { name: 'Женский', exact: true }).check()
  await page
    .getByLabel('Загрузить скриншот', { exact: true })
    .setInputFiles(fileURLToPath(new URL('card.png', fixtureRoot)))
  await expect(page.getByRole('status').first()).toContainText('Подготовка OCR')
  await page.getByRole('button', { name: 'Остановить', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
  await expect.poll(() => page.evaluate(() => window.__resources.workers)).toBe(0)
  await expect(page.locator('article.observation')).toHaveCount(0)
  expect(await page.evaluate(() => window.__resources.urls)).toBe(0)
  await page.getByRole('radio', { name: 'Мужской', exact: true }).check()
  await page
    .getByLabel('Загрузить скриншот', { exact: true })
    .setInputFiles(fileURLToPath(new URL('card.png', fixtureRoot)))
  await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
  await expect(
    page.locator('article.observation').getByText('Мужской стиль', { exact: true }),
  ).toBeVisible()
})

for (const asset of ['**/ocr/rus.traineddata', '**/ocr/tesseract-core*.wasm.js']) {
  test(`Ошибка загрузки OCR освобождает работников: ${asset}`, async ({ page }) => {
    await page.route(asset, (route) =>
      route.fulfill({ status: 503, body: 'Ресурс временно недоступен' }),
    )
    await page.goto('/')
    await page.getByRole('radio', { name: 'Женский', exact: true }).check()
    await page
      .getByLabel('Загрузить скриншот', { exact: true })
      .setInputFiles(fileURLToPath(new URL('card.png', fixtureRoot)))
    await expect(page.getByRole('alert')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__resources.workers)).toBe(0)
    expect(await page.evaluate(() => window.__resources.urls)).toBe(0)
    await page.unroute(asset)
    await page
      .getByLabel('Загрузить скриншот', { exact: true })
      .setInputFiles(fileURLToPath(new URL('card.png', fixtureRoot)))
    await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
    await expect(page.locator('article.observation h3')).toHaveText('Костюм Вишневая дискотека')
    await expect.poll(() => page.evaluate(() => window.__resources.workers)).toBe(0)
  })
}

test('Повреждённый файл даёт понятную ошибку и допускает повторную попытку', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: 'Женский', exact: true }).check()
  await page
    .getByLabel('Загрузить скриншот', { exact: true })
    .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') })
  await expect(page.getByRole('alert')).toContainText('Не удалось прочитать изображение')
  await expect.poll(() => page.evaluate(() => window.__resources.workers)).toBe(0)
  await expect(page.getByRole('button', { name: 'Начать захват', exact: true })).toBeEnabled()
})

test('Мобильный экран не имеет горизонтального переполнения', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await page.getByRole('radio', { name: 'Женский', exact: true }).check()
  await page
    .getByLabel('Загрузить скриншот', { exact: true })
    .setInputFiles(fileURLToPath(new URL('card.png', fixtureRoot)))
  await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'reports/mobile.png', fullPage: true })
})

for (const sample of [
  { current: 0, spaced: true },
  { current: 3, spaced: true },
  { current: 3, spaced: false },
]) {
  const { current, spaced } = sample
  test(`Несобранный стиль: ${current}/5 (${spaced ? 'отчётливый' : 'компактный'} счётчик)`, async ({
    page,
  }) => {
    const file = `partial-${current}-${spaced ? 'clear' : 'compact'}.png`
    await page.goto('/')
    await page.getByRole('radio', { name: 'Женский', exact: true }).check()
    await page.getByRole('checkbox', { name: 'Диагностика', exact: true }).check()
    const started = Date.now()
    await page.getByLabel('Загрузить скриншот', { exact: true }).setInputFiles({
      name: file,
      mimeType: 'image/png',
      buffer: await readFile(new URL(file, fixtureRoot)),
    })
    await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
    const cards = page.locator('article.observation')
    const fixture: FixtureLabel = {
      file,
      gender: 'F',
      name: 'Костюм Вишневая дискотека',
      status: 'not-collected',
      progress: `${current}/5`,
      cards: 1,
      provenance: `Производная исходной карточки: ${spaced ? 'разнесённый' : 'компактный'} счётчик Arial 13px, растр зафиксирован в PNG`,
    }
    measurements.push({
      fixture,
      elapsedMs: Date.now() - started,
      diagnostic: await page.getByRole('region', { name: 'Диагностика', exact: true }).innerText(),
      evidence: await cards.locator('.diagnostic').allTextContents(),
      observed: await cards.evaluateAll((elements) =>
        elements.map((element) => ({
          name: element.querySelector('h3')?.textContent ?? '',
          status: element.querySelector('.badge')?.textContent ?? '',
        })),
      ),
    })
    await expect(cards.locator('h3')).toHaveText('Костюм Вишневая дискотека')
    if (spaced)
      await expect(cards.locator('.badge')).toHaveText(`Не собран · ${current}/5`, {
        timeout: 1000,
      })
    else
      await expect(cards.locator('.badge')).toHaveText(/^(Не собран · 3\/5|Сбор не определён)$/, {
        timeout: 1000,
      })
    await expect.poll(() => page.evaluate(() => window.__resources.workers)).toBe(0)
  })
}

test.afterAll(async () => {
  const progressCases = measurements.filter(
    (m) => m.fixture.cards > 0 && m.fixture.status !== 'unknown',
  )
  const expectedStatus = (fixture: FixtureLabel) =>
    fixture.status === 'collected' ? 'Собран · 5/5' : `Не собран · ${fixture.progress ?? '?'}`
  const confirmedProgress = progressCases.filter((m) =>
    m.observed.every((o) => o.status === expectedStatus(m.fixture)),
  )
  const abstainedProgress = progressCases.filter((m) =>
    m.observed.some((o) => o.status === 'Сбор не определён'),
  )
  await mkdir('reports', { recursive: true })
  await writeFile(
    'reports/ocr-quality.json',
    JSON.stringify(
      {
        sourceImages: 1,
        cases: measurements.length,
        expectedCases: fixtureLabels.length + 3,
        complete: measurements.length === fixtureLabels.length + 3,
        quality: {
          namedCases: measurements.filter((m) => m.fixture.name !== null).length,
          confirmedNames: measurements.filter(
            (m) => m.fixture.name !== null && m.observed.every((o) => o.name === m.fixture.name),
          ).length,
          progressCases: progressCases.length,
          confirmedProgress: confirmedProgress.length,
          abstainedProgress: abstainedProgress.length,
          incorrectConfirmedProgress: progressCases.filter((m) =>
            m.observed.some(
              (o) => o.status !== 'Сбор не определён' && o.status !== expectedStatus(m.fixture),
            ),
          ).length,
        },
        note: 'Набор основан на одной карточке. Отказы от распознавания учтены отдельно от ошибок.',
        measurements,
      },
      null,
      2,
    ) + '\n',
  )
})
