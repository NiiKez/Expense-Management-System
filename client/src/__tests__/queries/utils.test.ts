import type { AxiosResponse } from 'axios'
import type { ApiResponse, PaginatedResponse } from '@/types'
import { unwrapData, unwrapPage } from '@/queries/utils'

// unwrapData / unwrapPage only ever read `res.data`; a bare `{ data }` cast to the
// axios response type is enough to exercise the envelope logic without a real HTTP
// round-trip.
function asRes<T>(body: unknown): AxiosResponse<T> {
  return { data: body } as AxiosResponse<T>
}

describe('unwrapData', () => {
  it('returns the payload on a successful envelope', () => {
    const res = asRes<ApiResponse<{ id: number }>>({ success: true, data: { id: 5 } })
    expect(unwrapData(res)).toEqual({ id: 5 })
  })

  it('throws the server-supplied error message when success is false', () => {
    const res = asRes<ApiResponse<unknown>>({ success: false, error: { message: 'nope' } })
    expect(() => unwrapData(res)).toThrow('nope')
  })

  it('throws the default message when data is null', () => {
    const res = asRes<ApiResponse<unknown>>({ success: true, data: null })
    expect(() => unwrapData(res)).toThrow('Request failed: response contained no data.')
  })

  it('throws the default message when data is undefined', () => {
    const res = asRes<ApiResponse<unknown>>({ success: true, data: undefined })
    expect(() => unwrapData(res)).toThrow('Request failed: response contained no data.')
  })

  it('throws the default message when the body is absent entirely', () => {
    const res = asRes<ApiResponse<unknown>>(undefined)
    expect(() => unwrapData(res)).toThrow('Request failed: response contained no data.')
  })
})

describe('unwrapPage', () => {
  it('uses the provided pagination + meta when present', () => {
    const res = asRes<PaginatedResponse<number>>({
      success: true,
      data: [1, 2, 3],
      pagination: { total: 30, page: 2, pageSize: 10 },
      meta: { source: 'graph' },
    })
    expect(unwrapPage(res)).toEqual({
      items: [1, 2, 3],
      total: 30,
      page: 2,
      pageSize: 10,
      meta: { source: 'graph' },
    })
  })

  it('falls back to items.length / page 1 when pagination is missing', () => {
    const res = asRes<PaginatedResponse<number>>({ success: true, data: [1, 2] })
    expect(unwrapPage(res)).toEqual({
      items: [1, 2],
      total: 2,
      page: 1,
      pageSize: 2,
      meta: undefined,
    })
  })

  it('defaults items to [] (and the derived counts to 0) when data is absent', () => {
    const res = asRes<PaginatedResponse<number>>({ success: true })
    expect(unwrapPage(res)).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 0,
      meta: undefined,
    })
  })
})
