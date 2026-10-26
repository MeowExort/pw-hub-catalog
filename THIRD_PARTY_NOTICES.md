# Сторонние материалы

Лицензия проекта распространяется только на собственный код и документацию. Она не заменяет условия сторонних компонентов и не предоставляет права на игровые материалы.

## Tesseract.js

[Tesseract.js 7.0.0](https://github.com/naptha/tesseract.js) распространяется по Apache License 2.0. Текст лицензии сохранён в [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt). Уведомления об авторских правах находятся в исходном пакете.

Файл `patches/tesseract.js@7.0.0.patch` изменяет `src/createWorker.js` и `src/index.d.ts`: добавляет отмену через `AbortSignal` и освобождение работников при ошибке инициализации. Изменения этих файлов также распространяются по Apache License 2.0.

## Языковые модели

Файлы `eng.traineddata` и `rus.traineddata` взяты из [naptha/tessdata](https://github.com/naptha/tessdata) и распространяются по [Apache License 2.0](licenses/Apache-2.0.txt). В репозитории сохранены распакованные модели `4.0.0_best_int` из пакетов `@tesseract.js-data/eng@1.0.0` и `@tesseract.js-data/rus@1.0.0`.

Контрольные суммы SHA-256:

```text
5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747  eng.traineddata
eb9be824435f6bb0f993925acb85fd842c8418d6db7613c818e749e619a1ad6d  rus.traineddata
```

## Игровые материалы

Названия и изображения Perfect World принадлежат соответствующим правообладателям. Изображения `tests/fixtures/card.png`, `tests/fixtures/name.png` и их производные `tests/fixtures/partial-*.png` используются для проверки распознавания. Лицензия проекта не предоставляет права на их коммерческое использование или дальнейшее распространение.

## Другие зависимости

React, React DOM и Scheduler распространяются по [MIT License](licenses/React-MIT.txt).

Остальные зависимости сохраняют свои лицензии и уведомления, поставляемые в соответствующих пакетах. Перечень версий закреплён в `pnpm-lock.yaml`. При сборке лицензии проекта и библиотек копируются в `dist/licenses/`, `dist/LICENSE` и `dist/THIRD_PARTY_NOTICES.md`. Уведомления о компонентах OCR-работника сохраняются в `dist/ocr/worker.min.js.LICENSE.txt`.
