import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fixtureRoot } from '../scripts/fixtures.ts'

for (const mimeType of ['image/jpeg', 'image/webp']) {
  test(`Декодирование ${mimeType}`, async ({ page }) => {
    const original = (await readFile(new URL('card.png', fixtureRoot))).toString('base64')
    await page.goto('/')
    const encoded = await page.evaluate(
      async ({ original, mimeType }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${original}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        canvas.getContext('2d')?.drawImage(image, 0, 0)
        return canvas.toDataURL(mimeType, 1).split(',')[1] ?? ''
      },
      { original, mimeType },
    )
    await page.getByRole('radio', { name: 'Женский', exact: true }).check()
    await page.getByLabel('Загрузить скриншот', { exact: true }).setInputFiles({
      name: mimeType === 'image/jpeg' ? 'card.jpg' : 'card.webp',
      mimeType,
      buffer: Buffer.from(encoded, 'base64'),
    })
    await expect(page.getByRole('status').first()).toHaveText('Обработка завершена.')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('article.observation')).toHaveCount(1)
  })
}
