import type { CatalogStyle, Gender, PriceSource, Rates, SourceType } from './model.ts'
import { normalizeName } from './recognition.ts'

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}: ожидался объект`)
  return value as Record<string, unknown>
}
const sourceTypes: readonly SourceType[] = ['SHOP_GOLD', 'FAIR_GOLD', 'GIFT_COINS']
function source(value: unknown): PriceSource {
  const v = record(value, 'Источник стоимости')
  const type = sourceTypes.find((t) => t === v.type)
  if (!type || typeof v.price !== 'number' || !Number.isFinite(v.price) || v.price < 0) {
    throw new Error('Некорректный тип источника или цена')
  }
  return { type, price: v.price }
}
export function parseCatalog(value: unknown, gender: Gender): CatalogStyle[] {
  if (!Array.isArray(value)) throw new Error('Справочник должен быть массивом')
  const ids = new Set<string>(),
    names = new Set<string>()
  return value.map((entry: unknown) => {
    const v = record(entry, 'Стиль')
    if (
      typeof v.id !== 'string' ||
      !v.id ||
      typeof v.name !== 'string' ||
      !v.name.trim() ||
      v.gender !== gender ||
      !Array.isArray(v.sources)
    ) {
      throw new Error('Некорректная запись стиля')
    }
    const name = v.name.trim()
    const key = normalizeName(name)
    if (ids.has(v.id) || names.has(key)) throw new Error(`Повтор стиля: ${name}`)
    ids.add(v.id)
    names.add(key)
    const sources = v.sources.map((s: unknown) => source(s))
    if (new Set(sources.map((s) => s.type)).size !== sources.length)
      throw new Error(`Повтор источника: ${name}`)
    return { id: v.id, name, gender, sources }
  })
}
export function parseRates(value: unknown): Rates {
  const v = record(value, 'Курсы')
  const positive = (key: string) => {
    const n = v[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0)
      throw new Error(`Некорректный курс: ${key}`)
    return n
  }
  return {
    auction_gold_to_yuan: positive('auction_gold_to_yuan'),
    ancient_coin_to_fair_gold_rate: positive('ancient_coin_to_fair_gold_rate'),
    ancient_coin_to_yuan: positive('ancient_coin_to_yuan'),
  }
}
export function calculateCost(source: PriceSource, rates: Rates): number {
  switch (source.type) {
    case 'SHOP_GOLD':
      return source.price * rates.auction_gold_to_yuan
    case 'FAIR_GOLD':
      return (source.price / rates.ancient_coin_to_fair_gold_rate) * rates.ancient_coin_to_yuan
    case 'GIFT_COINS':
      return source.price * rates.ancient_coin_to_yuan
    default: {
      const exhaustive: never = source.type
      throw new Error(`Неизвестный источник: ${String(exhaustive)}`)
    }
  }
}
