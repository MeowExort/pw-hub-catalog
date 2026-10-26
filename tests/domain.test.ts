import { describe, expect, it } from 'vitest'
import { calculateCost, parseCatalog, parseRates } from '../src/domain/catalog.ts'
import {
  chooseNameReading,
  chooseProgressReading,
  levenshtein,
  matchName,
  mergeObservations,
  readProgress,
  MAX_OBSERVATIONS,
} from '../src/domain/recognition.ts'
import { observation, style } from './helpers.ts'
import female from '../src/styles_f.json'
import male from '../src/styles_m.json'
import rawRates from '../src/rates.json'

describe('Распознавание названий', () => {
  it('принимает точное название и разумные ошибки OCR', () => {
    expect(matchName(style.name, 90, [style]).kind).toBe('matched')
    expect(matchName('Костюм Вишневгядискотека', 47, [style]).kind).toBe('matched')
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
  it('оставляет мусор, пустой текст и низкую уверенность неопределёнными', () => {
    for (const text of ['абракадабра', '', 'Костюм'])
      expect(matchName(text, 90, [style]).kind).toBe('unknown')
    expect(matchName(style.name, 1, [style])).toMatchObject({
      kind: 'unknown',
      reason: 'confidence',
    })
    expect(matchName(style.name, Number.NaN, [style]).kind).toBe('unknown')
    expect(matchName(style.name, 99, []).kind).toBe('unknown')
  })
  it('отклоняет неоднозначные совпадения и различает звёздные стили', () => {
    const names = [style, { ...style, id: 'f-other', name: `${style.name}а` }]
    expect(matchName(style.name, 90, names)).toMatchObject({ kind: 'unknown', reason: 'ambiguous' })
    expect(matchName(style.name, 90, [{ ...style, name: `★${style.name}` }]).kind).toBe('unknown')
    expect(matchName(`*${style.name}`, 90, [{ ...style, name: `★${style.name}` }]).kind).toBe(
      'matched',
    )
  })
})
describe('Подтверждение сбора', () => {
  it('выбирает подтверждённое чтение и отклоняет противоречивые варианты', () => {
    expect(
      chooseProgressReading([
        { text: '5/5', confidence: 90 },
        { text: '', confidence: 0 },
      ]).status,
    ).toBe('collected')
    expect(
      chooseProgressReading([
        { text: '5/5', confidence: 90 },
        { text: '3/5', confidence: 95 },
      ]).status,
    ).toBe('unknown')
    expect(chooseProgressReading([]).status).toBe('unknown')
    expect(
      chooseNameReading(
        [
          { text: '', confidence: 0 },
          { text: style.name, confidence: 90 },
        ],
        [style],
      ).match.kind,
    ).toBe('matched')
    const other = { ...style, id: 'other', name: 'Спортивный костюм' }
    expect(
      chooseNameReading(
        [
          { text: style.name, confidence: 90 },
          { text: other.name, confidence: 95 },
        ],
        [style, other],
      ).match.kind,
    ).toBe('unknown')
    expect(chooseNameReading([], [style]).match.kind).toBe('unknown')
  })
  it.each([
    ['5/5', 'collected'],
    ['0/5', 'not-collected'],
    ['3 / 5', 'not-collected'],
    ['0/0', 'unknown'],
    ['6/5', 'unknown'],
    ['1/99', 'unknown'],
    ['abc 5/5', 'unknown'],
    ['', 'unknown'],
  ])('%s → %s', (raw: string, status: string) => {
    expect(readProgress(raw, 90).status).toBe(status)
  })
  it('не подтверждает счётчик с низкой уверенностью', () => {
    expect(readProgress('5/5', 49).status).toBe('unknown')
    expect(readProgress('5/5', Number.NaN).status).toBe('unknown')
  })
})
describe('Объединение наблюдений', () => {
  it('сохраняет более качественное название и подтверждённый счётчик', () => {
    const strong = observation(),
      weak = observation({
        rawName: 'мусор',
        nameConfidence: 31,
        progress: readProgress('???', 0),
        observedAt: 2,
      })
    expect(mergeObservations([strong], [weak])[0]).toMatchObject({
      rawName: style.name,
      observedAt: 2,
      progress: { status: 'collected' },
    })
  })
  it('обновляет статус при более уверенном наблюдении', () => {
    expect(
      mergeObservations([observation()], [observation({ progress: readProgress('3/5', 99) })])[0]
        ?.progress.status,
    ).toBe('not-collected')
  })
  it('ограничивает размер результатов', () => {
    const incoming = Array.from({ length: 300 }, (_, i) =>
      observation({ id: String(i), observedAt: i }),
    )
    expect(mergeObservations([], incoming)).toHaveLength(MAX_OBSERVATIONS)
  })
  it('не вытесняет подтверждённые стили потоком неопределённых карточек', () => {
    const incoming = Array.from({ length: 200 }, (_, i) =>
      observation({
        id: `unknown-${i}`,
        match: { kind: 'unknown', reason: 'empty', candidate: null, distance: null },
        observedAt: 100 + i,
      }),
    )
    expect(mergeObservations([observation()], incoming).some((item) => item.id === style.id)).toBe(
      true,
    )
  })
})
describe('Справочники и стоимость', () => {
  it('проверяет реальные данные и все валюты', () => {
    expect(parseCatalog(female, 'F')).toHaveLength(12)
    expect(parseCatalog(male, 'M')).toHaveLength(71)
    const rates = parseRates(rawRates)
    expect(calculateCost({ type: 'SHOP_GOLD', price: 2 }, rates)).toBe(2_400_000)
    expect(calculateCost({ type: 'FAIR_GOLD', price: 5 }, rates)).toBe(1_200_000)
    expect(calculateCost({ type: 'GIFT_COINS', price: 2 }, rates)).toBe(1_200_000)
  })
  it.each([
    null,
    {},
    [{ ...style, gender: 'M' }],
    [style, style],
    [{ ...style, sources: [{ type: 'TYPO', price: 1 }] }],
    [{ ...style, sources: [{ type: 'SHOP_GOLD', price: -1 }] }],
    [
      {
        ...style,
        sources: [
          { type: 'SHOP_GOLD', price: 1 },
          { type: 'SHOP_GOLD', price: 2 },
        ],
      },
    ],
  ])('отклоняет повреждённый справочник %#', (value: unknown) => {
    expect(() => parseCatalog(value, 'F')).toThrow()
  })
  it('не принимает нулевые и бесконечные курсы', () => {
    expect(() => parseRates({ ...rawRates, ancient_coin_to_yuan: 0 })).toThrow()
    expect(() => parseRates({ ...rawRates, auction_gold_to_yuan: Infinity })).toThrow()
    expect(() => parseRates(null)).toThrow()
  })
})
