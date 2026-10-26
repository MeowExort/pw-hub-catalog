import { calculateCost } from '../domain/catalog.ts'
import { rates } from '../data/catalog.ts'
import type { Observation, SourceType } from '../domain/model.ts'
import { BlobImage } from './blob-image.tsx'
import { statusLabels } from './labels.ts'
const sourceLabels: Readonly<Record<SourceType, string>> = {
  SHOP_GOLD: 'Магазин',
  FAIR_GOLD: 'Ярмарка',
  GIFT_COINS: 'МДМ',
}
export function ObservationCard({
  observation,
  debug,
}: {
  observation: Observation
  debug: boolean
}) {
  const { match, progress } = observation
  const name = match.kind === 'matched' ? match.style.name : 'Название не распознано'
  return (
    <article className={`observation ${progress.status}`}>
      <BlobImage
        blob={observation.preview}
        className="card-preview"
        alt={`Карточка: ${name}`}
        loading="lazy"
      />
      <div className="card-content">
        <h3>{name}</h3>
        <p className="badge">
          {statusLabels[progress.status]}
          {progress.current !== null && ` · ${progress.current}/${progress.total}`}
        </p>
        {match.kind === 'unknown' && (
          <p className="muted">OCR: {observation.rawName || 'нет текста'}</p>
        )}
        {match.kind === 'matched' && (
          <>
            <p className="muted">{match.style.gender === 'F' ? 'Женский' : 'Мужской'} стиль</p>
            {match.style.sources.length ? (
              <details>
                <summary>Справочная стоимость</summary>
                <ul>
                  {match.style.sources.map((source) => (
                    <li key={source.type}>
                      {sourceLabels[source.type]}: {source.price} · ≈{' '}
                      {(calculateCost(source, rates) / 1_000_000).toLocaleString('ru-RU', {
                        maximumFractionDigits: 2,
                      })}{' '}
                      млн юаней
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="muted">Нет данных о способах получения.</p>
            )}
          </>
        )}
        {debug && (
          <details className="diagnostic">
            <summary>Данные распознавания</summary>
            <dl>
              <dt>Исходное название</dt>
              <dd>{observation.rawName || '—'}</dd>
              <dt>Уверенность названия</dt>
              <dd>{observation.nameConfidence.toFixed(1)}%</dd>
              <dt>Счётчик OCR</dt>
              <dd>
                {progress.raw || '—'} ({progress.confidence.toFixed(1)}%)
              </dd>
              <dt>Сходство с каталогом</dt>
              <dd>
                {match.kind === 'matched'
                  ? `${((1 - match.distance) * 100).toFixed(1)}%`
                  : match.reason}
              </dd>
            </dl>
          </details>
        )}
      </div>
    </article>
  )
}
