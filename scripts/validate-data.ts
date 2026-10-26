import { readFile } from 'node:fs/promises'
import { parseCatalog, parseRates } from '../src/domain/catalog.ts'

const json = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')) as unknown
const female = parseCatalog(await json('styles_f.json'), 'F')
const male = parseCatalog(await json('styles_m.json'), 'M')
parseRates(await json('rates.json'))
const styles = [...female, ...male]
if (new Set(styles.map((s) => s.id)).size !== styles.length)
  throw new Error('Идентификаторы стилей должны быть уникальными во всём каталоге')
console.log(
  `Справочники проверены: ${female.length} женских и ${male.length} мужских стилей; ${styles.filter((s) => !s.sources.length).length} без сведений о стоимости.`,
)
