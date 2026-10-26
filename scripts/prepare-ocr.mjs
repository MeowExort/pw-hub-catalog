import { copyFile, cp, mkdir, readdir, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const target = new URL('../public/ocr/', import.meta.url)
await mkdir(target, { recursive: true })
const packageRoot = dirname(require.resolve('tesseract.js/package.json'))
const coreRoot = dirname(
  require.resolve('tesseract.js-core/package.json', { paths: [packageRoot] }),
)
const coreFiles = (await readdir(coreRoot)).filter((file) => /-lstm\.wasm(?:\.js)?$/.test(file))
const expected = new Set([
  'worker.min.js',
  'worker.min.js.LICENSE.txt',
  'rus.traineddata',
  'eng.traineddata',
  ...coreFiles,
])
for (const file of await readdir(target)) {
  if (!expected.has(file) && (file.startsWith('tesseract-core') || file === 'eng.traineddata'))
    await unlink(new URL(file, target))
}
await copyFile(join(packageRoot, 'dist/worker.min.js'), new URL('worker.min.js', target))
await copyFile(
  join(packageRoot, 'dist/worker.min.js.LICENSE.txt'),
  new URL('worker.min.js.LICENSE.txt', target),
)
for (const file of coreFiles) await copyFile(join(coreRoot, file), new URL(file, target))
await copyFile(new URL('../rus.traineddata', import.meta.url), new URL('rus.traineddata', target))
await copyFile(new URL('../eng.traineddata', import.meta.url), new URL('eng.traineddata', target))
await cp(
  new URL('../licenses/', import.meta.url),
  new URL('../public/licenses/', import.meta.url),
  {
    recursive: true,
  },
)
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  await copyFile(
    new URL(`../${file}`, import.meta.url),
    new URL(`../public/${file}`, import.meta.url),
  )
}
console.log('OCR-ресурсы готовы.')
