import { useState } from 'react'
import type { CollectionStatus, Gender } from './domain/model.ts'
import { catalogs, dataProvenance } from './data/catalog.ts'
import { DEFAULT_CALIBRATION } from './imaging/segmentation.ts'
import { useCatalogSession } from './session/use-catalog-session.ts'
import type { SessionPhase } from './session/controller.ts'
import { ObservationCard } from './ui/observation-card.tsx'
import { statusLabels } from './ui/labels.ts'
import { BlobImage } from './ui/blob-image.tsx'
import './App.css'

const phaseLabels: Readonly<Record<SessionPhase, string>> = {
  idle: 'Выберите пол персонажа и источник изображения.',
  starting: 'Выберите окно с каталогом…',
  loading: 'Подготовка OCR…',
  capturing: 'Идёт захват и обработка каталога.',
  processing: 'Распознавание изображения…',
  stopped: 'Обработка завершена.',
  error: 'Ошибка обработки.',
}
type Filter = 'all' | CollectionStatus | 'unrecognized'
function isFilter(value: string): value is Filter {
  return ['all', 'collected', 'not-collected', 'unknown', 'unrecognized'].includes(value)
}
export default function App() {
  const [gender, setGender] = useState<Gender | null>(null)
  const [debug, setDebug] = useState(false)
  const [cardWidth, setCardWidth] = useState('auto')
  const [filter, setFilter] = useState<Filter>('all')
  const { state, start, stop, analyzeFile } = useCatalogSession()
  const busy = ['starting', 'loading', 'capturing', 'processing'].includes(state.phase)
  const calibration = {
    ...DEFAULT_CALIBRATION,
    cardWidth: cardWidth === 'auto' ? null : Number(cardWidth),
  }
  const observations = state.observations.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'unrecognized' ? item.match.kind === 'unknown' : item.progress.status === filter),
  )
  const settled = state.stats.processed + state.stats.skipped + state.stats.failed
  const screenSupported = typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  return (
    <main className="page">
      <header>
        <p className="eyebrow">Perfect World</p>
        <h1>Каталог стилей</h1>
        <p className="intro">
          Проверка стилей по скриншоту каталога. Обработка выполняется в браузере.
        </p>
      </header>
      <section className="panel" aria-label="Настройки и источник">
        <div className="controls">
          <fieldset disabled={busy}>
            <legend>Пол персонажа</legend>
            <label>
              <input
                type="radio"
                name="gender"
                checked={gender === 'F'}
                onChange={() => setGender('F')}
              />{' '}
              Женский
            </label>
            <label>
              <input
                type="radio"
                name="gender"
                checked={gender === 'M'}
                onChange={() => setGender('M')}
              />{' '}
              Мужской
            </label>
          </fieldset>
          <div className="field">
            <label htmlFor="card-width">Ширина карточки</label>
            <select
              id="card-width"
              value={cardWidth}
              onChange={(event) => setCardWidth(event.target.value)}
              disabled={busy}
            >
              <option value="auto">Определить автоматически</option>
              {[111, 148, 185, 222, 296].map((width) => (
                <option key={width} value={width}>
                  {width} px
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="controls actions">
          <button
            className="primary"
            disabled={!gender || busy || !screenSupported}
            onClick={() => {
              if (gender) {
                setFilter('all')
                void start(gender, calibration)
              }
            }}
          >
            Начать захват
          </button>
          <button disabled={!busy} onClick={stop}>
            Остановить
          </button>
          <label className={`upload ${!gender || busy ? 'disabled' : ''}`}>
            Загрузить скриншот
            <input
              aria-label="Загрузить скриншот"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!gender || busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file && gender) {
                  setFilter('all')
                  void analyzeFile(file, gender, calibration)
                }
                event.target.value = ''
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={debug}
              onChange={(event) => setDebug(event.target.checked)}
            />{' '}
            Диагностика
          </label>
        </div>
        {!screenSupported && (
          <p className="muted">
            Захват экрана недоступен в этом браузере. Используйте загрузку изображения.
          </p>
        )}
        <p className="muted">
          PNG, JPEG или WebP, до 20 МБ и 16 млн пикселей. Карточки должны быть видны целиком.
        </p>
        <div role="status" aria-live="polite">
          <p>{phaseLabels[state.phase]}</p>
        </div>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        {state.stats.captured > 0 && (
          <div className="statistics">
            <p>
              Кадров: {state.stats.captured} · Обработано: {state.stats.processed} · Пропущено:{' '}
              {state.stats.skipped} · Повторов: {state.stats.duplicates} · Ошибок:{' '}
              {state.stats.failed} · В работе: {state.stats.pending}
            </p>
            <progress aria-label="Обработка кадров" value={settled} max={state.stats.captured} />
          </div>
        )}
      </section>
      <aside className="data-note">
        Неполный справочник: {catalogs.F.length} женских и {catalogs.M.length} мужских стилей.{' '}
        {dataProvenance.note}
      </aside>
      <section aria-labelledby="results-title">
        <div className="results-heading">
          <h2 id="results-title">
            Результаты <span>{state.observations.length}</span>
          </h2>
          <div className="field">
            <label htmlFor="results-filter">Показать</label>
            <select
              id="results-filter"
              value={filter}
              onChange={(event) => {
                if (isFilter(event.target.value)) setFilter(event.target.value)
              }}
            >
              <option value="all">Все карточки</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
              <option value="unrecognized">Название не распознано</option>
            </select>
          </div>
        </div>
        {state.diagnostics?.warnings.map((warning) => (
          <p key={warning} className="notice" role="status">
            {warning}
          </p>
        ))}
        {observations.length ? (
          <div className="results-grid">
            {observations.map((observation) => (
              <ObservationCard key={observation.id} observation={observation} debug={debug} />
            ))}
          </div>
        ) : (
          <p className="empty">
            {state.observations.length ? 'Нет карточек с выбранным фильтром.' : 'Нет результатов.'}
          </p>
        )}
      </section>
      {debug && (
        <section className="panel diagnostic" aria-label="Диагностика">
          <h2>Диагностика</h2>
          {state.diagnostics ? (
            <p>
              Работников OCR: {state.diagnostics.workerCount} · Подготовка:{' '}
              {state.diagnostics.segmentationMs.toFixed(0)} мс · OCR:{' '}
              {state.diagnostics.ocrMs.toFixed(0)} мс · Всего:{' '}
              {state.diagnostics.totalMs.toFixed(0)} мс
            </p>
          ) : (
            <p>Данные появятся после обработки кадра.</p>
          )}
          {state.preview && (
            <details>
              <summary>Последний исходный кадр</summary>
              <BlobImage
                className="frame-preview"
                blob={state.preview}
                alt="Последний кадр каталога"
              />
            </details>
          )}
        </section>
      )}
    </main>
  )
}
