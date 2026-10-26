import type { CollectionStatus } from '../domain/model.ts'
export const statusLabels: Readonly<Record<CollectionStatus, string>> = {
  collected: 'Собран',
  'not-collected': 'Не собран',
  unknown: 'Сбор не определён',
}
