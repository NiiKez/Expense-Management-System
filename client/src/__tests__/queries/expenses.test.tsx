import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../helpers/renderWithProviders'
import type { Expense, Comment, Receipt } from '../../types'
import { Category, Status, Role } from '../../types'

jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
jest.mock('@/services/api')
import api from '@/services/api'
import {
  useExpenses,
  useExpense,
  useExpenseComments,
  useCreateExpense,
  useUpdateExpense,
  useResubmitExpense,
  useDeleteExpense,
  useAddComment,
  fetchReceiptBlob,
  expenseKeys,
  type ExpenseListParams,
} from '@/queries/expenses'

const mockedApi = api as jest.Mocked<typeof api>

const expense: Expense = {
  id: 7,
  submitted_by: 1,
  title: 'Taxi',
  description: null,
  amount: 42,
  currency: 'USD',
  category: Category.TRAVEL,
  expense_date: '2024-02-01',
  status: Status.PENDING,
  approved_by: null,
  rejection_reason: null,
  version: 1,
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
}

const receipt: Receipt = {
  id: 3,
  expense_id: 7,
  file_name: 'r.png',
  file_path: '/x',
  mime_type: 'image/png',
  file_size: 10,
  uploaded_at: '2024-02-01T00:00:00Z',
}

const baseParams: ExpenseListParams = { page: 1, pageSize: 20 }

beforeEach(() => jest.clearAllMocks())

describe('useExpenses', () => {
  it('GETs /expenses with params and normalizes the page', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: [expense], pagination: { total: 1, page: 1, pageSize: 20 } },
    })
    const { wrapper } = createQueryWrapper()
    const params: ExpenseListParams = { ...baseParams, search: 'taxi', status: Status.PENDING }
    const { result } = renderHook(() => useExpenses(params), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/expenses', { params })
    expect(result.current.data).toEqual({
      items: [expense],
      total: 1,
      page: 1,
      pageSize: 20,
      meta: undefined,
    })
  })
})

describe('useExpense', () => {
  it('GETs /expenses/{id} when id is valid', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: { ...expense, receipts: [receipt] } },
    })
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useExpense(7), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/expenses/7')
    expect(result.current.data?.receipts).toEqual([receipt])
  })

  it('is disabled for null / non-positive ids', () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useExpense(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockedApi.get).not.toHaveBeenCalled()
  })
})

describe('useExpenseComments', () => {
  it('GETs comments and sorts them oldest-first', async () => {
    const c1: Comment = {
      id: 1,
      expense_id: 7,
      author_id: 1,
      author_role: Role.EMPLOYEE,
      body: 'first',
      created_at: '2024-02-01T10:00:00Z',
    }
    const c2: Comment = { ...c1, id: 2, body: 'second', created_at: '2024-02-02T10:00:00Z' }
    // Return out of order; hook should sort ascending.
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: [c2, c1] } })
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useExpenseComments(7), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/expenses/7/comments')
    expect(result.current.data?.map((c) => c.id)).toEqual([1, 2])
  })
})

describe('useCreateExpense', () => {
  it('POSTs FormData and invalidates lists + stats + notifications', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: expense } })
    const { client, wrapper } = createQueryWrapper()
    const spy = jest.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCreateExpense(), { wrapper })

    const fd = new FormData()
    fd.append('title', 'Taxi')
    result.current.mutate(fd)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.post).toHaveBeenCalledWith('/expenses', fd)
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(expenseKeys.lists))
    expect(keys).toContain(JSON.stringify(['me', 'stats']))
    expect(keys).toContain(JSON.stringify(['manager', 'stats']))
    expect(keys).toContain(JSON.stringify(['admin', 'stats']))
    expect(keys).toContain(JSON.stringify(['notifications']))
  })
})

describe('useUpdateExpense', () => {
  it('PUTs the body and invalidates detail(id) + lists + stats', async () => {
    mockedApi.put.mockResolvedValueOnce({ data: { success: true, data: expense } })
    const { client, wrapper } = createQueryWrapper()
    const spy = jest.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateExpense(), { wrapper })

    result.current.mutate({ id: 7, body: { title: 'New' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.put).toHaveBeenCalledWith('/expenses/7', { title: 'New' })
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(expenseKeys.detail(7)))
    expect(keys).toContain(JSON.stringify(expenseKeys.lists))
  })
})

describe('useResubmitExpense', () => {
  it('POSTs to /resubmit and invalidates detail(id) + lists + admin root + stats + notifications', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: expense } })
    const { client, wrapper } = createQueryWrapper()
    const spy = jest.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useResubmitExpense(), { wrapper })

    result.current.mutate({ id: 7, body: { title: 'Redo' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.post).toHaveBeenCalledWith('/expenses/7/resubmit', { title: 'Redo' })
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    // A resubmit re-enters the pending queue, so it fans out to every list/stat
    // surface that can show it (lists + admin root + submitter/mgr/admin stats)
    // plus the detail and the recipient's notifications.
    expect(keys).toContain(JSON.stringify(expenseKeys.lists))
    expect(keys).toContain(JSON.stringify(['admin', 'expenses']))
    expect(keys).toContain(JSON.stringify(expenseKeys.detail(7)))
    expect(keys).toContain(JSON.stringify(['me', 'stats']))
    expect(keys).toContain(JSON.stringify(['manager', 'stats']))
    expect(keys).toContain(JSON.stringify(['admin', 'stats']))
    expect(keys).toContain(JSON.stringify(['notifications']))
  })
})

describe('useDeleteExpense', () => {
  it('DELETEs and invalidates lists + stats', async () => {
    mockedApi.delete.mockResolvedValueOnce({ data: { success: true } })
    const { client, wrapper } = createQueryWrapper()
    const spy = jest.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteExpense(), { wrapper })

    result.current.mutate(7)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.delete).toHaveBeenCalledWith('/expenses/7')
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(expenseKeys.lists))
    expect(keys).toContain(JSON.stringify(['me', 'stats']))
  })
})

describe('useAddComment', () => {
  it('POSTs the body, appends to the detail thread cache, invalidates notifications', async () => {
    const created: Comment = {
      id: 5,
      expense_id: 7,
      author_id: 1,
      body: 'hi',
      created_at: '2024-02-03T10:00:00Z',
    }
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: created } })
    const { client, wrapper } = createQueryWrapper()
    // Seed an existing thread to assert append behavior.
    const existing: Comment = { ...created, id: 4, body: 'older', created_at: '2024-02-02T10:00:00Z' }
    client.setQueryData(expenseKeys.comments(7), [existing])
    const spy = jest.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useAddComment(), { wrapper })
    result.current.mutate({ id: 7, body: 'hi' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.post).toHaveBeenCalledWith('/expenses/7/comments', { body: 'hi' })
    expect(client.getQueryData<Comment[]>(expenseKeys.comments(7))?.map((c) => c.id)).toEqual([4, 5])
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(['notifications']))
  })
})

describe('fetchReceiptBlob', () => {
  it('GETs the receipt as a blob', async () => {
    const blob = new Blob(['x'])
    mockedApi.get.mockResolvedValueOnce({ data: blob })
    const out = await fetchReceiptBlob(7, 3)
    expect(mockedApi.get).toHaveBeenCalledWith('/expenses/7/receipts/3', { responseType: 'blob' })
    expect(out).toBe(blob)
  })
})
