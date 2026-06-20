import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  type QueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import api from '@/services/api'
import type { ApiResponse, PaginatedResponse, Expense, Receipt, Comment } from '@/types'
import { unwrapData, unwrapPage, type Page } from './utils'
import { meKeys } from './me'
import { managerKeys } from './manager'
import { adminKeys } from './admin'
import { notificationKeys } from './notifications'

/** An expense detail payload carries its receipts inline. */
export type ExpenseWithReceipts = Expense & { receipts?: Receipt[] }

export interface ExpenseListParams {
  page: number
  pageSize: number
  search?: string
  status?: string
  category?: string
  sort?: string
  order?: string
}

/** Query keys for the expenses module. */
export const expenseKeys = {
  all: ['expenses'] as const,
  lists: ['expenses', 'list'] as const,
  list: (params: ExpenseListParams) => ['expenses', 'list', params] as const,
  details: ['expenses', 'detail'] as const,
  detail: (id: number) => ['expenses', 'detail', id] as const,
  comments: (id: number) => ['expenses', 'detail', id, 'comments'] as const,
}

/**
 * Stats that every expense write can affect (a new/edited/deleted expense
 * shifts the employee's totals and, depending on role, the manager/admin
 * roll-ups). Invalidated together to kill cross-screen staleness.
 */
function invalidateAllStats(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: meKeys.stats })
  void qc.invalidateQueries({ queryKey: managerKeys.stats })
  void qc.invalidateQueries({ queryKey: adminKeys.stats })
}

function isValidId(id: number | null): id is number {
  return id !== null && Number.isSafeInteger(id) && id > 0
}

function sortByCreatedAtAsc(list: Comment[]): Comment[] {
  return [...list].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** GET /expenses — the current user's expense list (filters/sort/pagination). */
export function useExpenses(
  params: ExpenseListParams,
  opts?: { enabled?: boolean },
): UseQueryResult<Page<Expense>, Error> {
  return useQuery({
    queryKey: expenseKeys.list(params),
    queryFn: async () =>
      unwrapPage(await api.get<PaginatedResponse<Expense>>('/expenses', { params })),
    enabled: opts?.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

/** GET /expenses/{id} — a single expense with its receipts. Skips invalid ids. */
export function useExpense(
  id: number | null,
  opts?: { enabled?: boolean },
): UseQueryResult<ExpenseWithReceipts, Error> {
  const valid = isValidId(id)
  return useQuery({
    queryKey: expenseKeys.detail(valid ? id : 0),
    queryFn: async () =>
      unwrapData(await api.get<ApiResponse<ExpenseWithReceipts>>(`/expenses/${id}`)),
    enabled: valid && (opts?.enabled ?? true),
  })
}

/** GET /expenses/{id}/comments — the thread, sorted oldest-first. */
export function useExpenseComments(
  id: number | null,
  opts?: { enabled?: boolean },
): UseQueryResult<Comment[], Error> {
  const valid = isValidId(id)
  return useQuery({
    queryKey: expenseKeys.comments(valid ? id : 0),
    queryFn: async () =>
      sortByCreatedAtAsc(unwrapData(await api.get<ApiResponse<Comment[]>>(`/expenses/${id}/comments`))),
    enabled: valid && (opts?.enabled ?? true),
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** POST /expenses — create a new expense (multipart, may include a receipt). */
export function useCreateExpense(): UseMutationResult<Expense, Error, FormData> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: FormData) =>
      unwrapData(await api.post<ApiResponse<Expense>>('/expenses', data)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: expenseKeys.lists })
      void qc.invalidateQueries({ queryKey: adminKeys.expensesRoot })
      invalidateAllStats(qc)
      void qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

/** PUT /expenses/{id} — update a pending expense in place. */
export function useUpdateExpense(): UseMutationResult<
  Expense,
  Error,
  { id: number; body: Record<string, unknown> }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }) =>
      unwrapData(await api.put<ApiResponse<Expense>>(`/expenses/${id}`, body)),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: expenseKeys.lists })
      void qc.invalidateQueries({ queryKey: adminKeys.expensesRoot })
      void qc.invalidateQueries({ queryKey: expenseKeys.detail(id) })
      invalidateAllStats(qc)
    },
  })
}

/** POST /expenses/{id}/resubmit — resubmit a rejected expense (back to PENDING). */
export function useResubmitExpense(): UseMutationResult<
  Expense,
  Error,
  { id: number; body: Record<string, unknown> }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }) =>
      unwrapData(await api.post<ApiResponse<Expense>>(`/expenses/${id}/resubmit`, body)),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: expenseKeys.lists })
      void qc.invalidateQueries({ queryKey: adminKeys.expensesRoot })
      void qc.invalidateQueries({ queryKey: expenseKeys.detail(id) })
      invalidateAllStats(qc)
      void qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

/** DELETE /expenses/{id} — permanently remove an expense and its receipts. */
export function useDeleteExpense(): UseMutationResult<void, Error, number> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/expenses/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: expenseKeys.lists })
      void qc.invalidateQueries({ queryKey: adminKeys.expensesRoot })
      invalidateAllStats(qc)
    },
  })
}

/**
 * POST /expenses/{id}/comments — adds a comment.
 * Optimistically appends the created comment to the detail thread cache on
 * success, then invalidates notifications (a comment may notify the other
 * party). We append on success (we have the server's row, incl. id/author)
 * rather than guessing an optimistic placeholder.
 */
export function useAddComment(): UseMutationResult<
  Comment,
  Error,
  { id: number; body: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }) =>
      unwrapData(await api.post<ApiResponse<Comment>>(`/expenses/${id}/comments`, { body })),
    onSuccess: (created, { id }) => {
      qc.setQueryData<Comment[]>(expenseKeys.comments(id), (prev) =>
        sortByCreatedAtAsc([...(prev ?? []), created]),
      )
      void qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

// ── Imperative helper ──────────────────────────────────────────────────────────

/**
 * GET a receipt as a Blob. Imperative (not a query) because a receipt download/
 * preview is a one-off browser action, not cache state worth retaining.
 */
export async function fetchReceiptBlob(expenseId: number, receiptId: number): Promise<Blob> {
  const res = await api.get(`/expenses/${expenseId}/receipts/${receiptId}`, {
    responseType: 'blob',
  })
  return res.data as Blob
}
