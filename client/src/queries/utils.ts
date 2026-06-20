import type { AxiosResponse } from 'axios'
import type { ApiResponse, PaginatedResponse, ResponseMeta } from '@/types'

/**
 * Normalized page shape every list query hook resolves to. Consumers read
 * `data?.items ?? []` rather than digging into the raw axios/envelope shape.
 */
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  meta?: ResponseMeta
}

/**
 * Unwraps the `{ success, data }` API envelope to the bare payload.
 * Throws a clear Error when the call failed or `data` is absent so the
 * surrounding query lands in its `isError` state instead of resolving to
 * `undefined` and crashing a consumer downstream.
 */
export function unwrapData<T>(res: AxiosResponse<ApiResponse<T>>): T {
  const body = res.data
  if (!body || body.success === false || body.data === undefined || body.data === null) {
    throw new Error(body?.error?.message ?? 'Request failed: response contained no data.')
  }
  return body.data
}

/**
 * Unwraps a paginated `{ success, data: T[], pagination, meta }` envelope into
 * the normalized {@link Page} shape. Missing items default to `[]`; missing
 * pagination defaults to a single page sized to the items returned.
 */
export function unwrapPage<T>(res: AxiosResponse<PaginatedResponse<T>>): Page<T> {
  const body = res.data
  const items = body?.data ?? []
  const pagination = body?.pagination
  return {
    items,
    total: pagination?.total ?? items.length,
    page: pagination?.page ?? 1,
    pageSize: pagination?.pageSize ?? items.length,
    meta: body?.meta,
  }
}
