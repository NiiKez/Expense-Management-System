import { nextSort, type SortState } from '@/lib/sort'

describe('nextSort', () => {
  it('starts a newly-clicked column at descending', () => {
    const prev: SortState = { key: null, order: 'asc' }
    expect(nextSort(prev, 'amount')).toEqual({ key: 'amount', order: 'desc' })
  })

  it('switches to a different column at descending regardless of prior order', () => {
    const prev: SortState = { key: 'date', order: 'asc' }
    expect(nextSort(prev, 'amount')).toEqual({ key: 'amount', order: 'desc' })
  })

  it('flips the active column from desc to asc', () => {
    const prev: SortState = { key: 'amount', order: 'desc' }
    expect(nextSort(prev, 'amount')).toEqual({ key: 'amount', order: 'asc' })
  })

  it('flips the active column from asc back to desc', () => {
    const prev: SortState = { key: 'amount', order: 'asc' }
    expect(nextSort(prev, 'amount')).toEqual({ key: 'amount', order: 'desc' })
  })
})
