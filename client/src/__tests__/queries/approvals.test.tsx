import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../helpers/renderWithProviders'
import type { Expense } from '../../types'
import { Category, Status } from '../../types'
import type { Page } from '@/queries/utils'

jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
jest.mock('@/services/api')
import api from '@/services/api'
import {
  usePendingApprovals,
  useApproveExpense,
  useRejectExpense,
  approvalKeys,
  type PendingParams,
} from '@/queries/approvals'

const mockedApi = api as jest.Mocked<typeof api>

function makeWrapper() {
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

function makeExpense(id: number): Expense {
  return {
    id,
    submitted_by: 2,
    title: `E${id}`,
    description: null,
    amount: 10,
    currency: 'USD',
    category: Category.MEALS,
    expense_date: '2024-02-01',
    status: Status.PENDING,
    approved_by: null,
    rejection_reason: null,
    version: 1,
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-02-01T00:00:00Z',
  }
}

const params: PendingParams = { page: 1, pageSize: 20 }

beforeEach(() => jest.clearAllMocks())

describe('usePendingApprovals', () => {
  it('GETs /approvals/pending and normalizes the page (incl. meta)', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [makeExpense(1)],
        pagination: { total: 1, page: 1, pageSize: 20 },
        meta: { source: 'graph' },
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePendingApprovals(params), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/approvals/pending', { params })
    expect(result.current.data?.total).toBe(1)
    expect(result.current.data?.meta).toEqual({ source: 'graph' })
  })
})

describe('useApproveExpense', () => {
  it('PATCHes approve, optimistically removes from the pending cache, invalidates', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: { success: true } })
    const { client, wrapper } = makeWrapper()
    const key = approvalKeys.pending(params)
    const seed: Page<Expense> = {
      items: [makeExpense(1), makeExpense(2)],
      total: 2,
      page: 1,
      pageSize: 20,
    }
    client.setQueryData(key, seed)
    const spy = jest.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useApproveExpense(), { wrapper })
    result.current.mutate(1)

    // Optimistic removal applies synchronously in onMutate.
    await waitFor(() => {
      const cached = client.getQueryData<Page<Expense>>(key)
      expect(cached?.items.map((e) => e.id)).toEqual([2])
    })
    expect(client.getQueryData<Page<Expense>>(key)?.total).toBe(1)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.patch).toHaveBeenCalledWith('/approvals/1/approve')
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(approvalKeys.pendingRoot))
    expect(keys).toContain(JSON.stringify(['manager', 'stats']))
    expect(keys).toContain(JSON.stringify(['notifications']))
    // A decision flips the expense's status, so the lists that can show it and
    // the submitter's own roll-up must be invalidated too (not just the queue).
    expect(keys).toContain(JSON.stringify(['expenses', 'list']))
    expect(keys).toContain(JSON.stringify(['admin', 'expenses']))
    expect(keys).toContain(JSON.stringify(['me', 'stats']))
    expect(keys).toContain(JSON.stringify(['admin', 'stats']))
  })

  it('rolls the cache back when the request fails', async () => {
    mockedApi.patch.mockRejectedValueOnce(new Error('boom'))
    const { client, wrapper } = makeWrapper()
    const key = approvalKeys.pending(params)
    const seed: Page<Expense> = { items: [makeExpense(1), makeExpense(2)], total: 2, page: 1, pageSize: 20 }
    client.setQueryData(key, seed)

    const { result } = renderHook(() => useApproveExpense(), { wrapper })
    result.current.mutate(1)

    await waitFor(() => expect(result.current.isError).toBe(true))
    // Rolled back to both items.
    expect(client.getQueryData<Page<Expense>>(key)?.items.map((e) => e.id)).toEqual([1, 2])
  })
})

describe('useRejectExpense', () => {
  it('PATCHes reject with a reason and optimistically removes from the cache', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: { success: true } })
    const { client, wrapper } = makeWrapper()
    const key = approvalKeys.pending(params)
    client.setQueryData<Page<Expense>>(key, {
      items: [makeExpense(1), makeExpense(2)],
      total: 2,
      page: 1,
      pageSize: 20,
    })

    const spy = jest.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRejectExpense(), { wrapper })
    result.current.mutate({ id: 2, reason: 'nope' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.patch).toHaveBeenCalledWith('/approvals/2/reject', { reason: 'nope' })
    expect(client.getQueryData<Page<Expense>>(key)?.items.map((e) => e.id)).toEqual([1])

    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(['expenses', 'list']))
    expect(keys).toContain(JSON.stringify(['admin', 'expenses']))
    expect(keys).toContain(JSON.stringify(['me', 'stats']))
  })
})
