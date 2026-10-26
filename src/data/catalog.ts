import female from '../styles_f.json'
import male from '../styles_m.json'
import rawRates from '../rates.json'
import { parseCatalog, parseRates } from '../domain/catalog.ts'
import type { Gender } from '../domain/model.ts'

export const catalogs = { F: parseCatalog(female, 'F'), M: parseCatalog(male, 'M') }
export const rates = parseRates(rawRates)
export const dataProvenance = {
  verifiedAt: null,
  note: 'Цены и курсы требуют проверки в игре.',
} as const
export const catalogFor = (gender: Gender) => catalogs[gender]
