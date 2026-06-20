export type SortOrder = 'asc' | 'desc'

export interface SortState {
  key: string | null
  order: SortOrder
}

/** Toggle helper: clicking the active column flips order; a new column starts desc. */
export function nextSort(prev: SortState, key: string): SortState {
  if (prev.key === key) return { key, order: prev.order === 'asc' ? 'desc' : 'asc' }
  return { key, order: 'desc' }
}
