import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import api from '@/services/api'
import type { PaginatedResponse, Expense } from '@/types'
import { unwrapPage, type Page } from './utils'
import { adminKeys } from './admin'
import { expenseKeys, invalidateAllStats } from './expenses'
import { notificationKeys } from './notifications'

export interface PendingParams {
  page: number
  pageSize: number
}

/** Query keys for the approvals module. */
export const approvalKeys = {
  all: ['approvals'] as const,
  pendingRoot: ['approvals', 'pending'] as const,
  pending: (params: PendingParams) => ['approvals', 'pending', params] as const,
}

/** Context carried from onMutate to onError for optimistic-rollback. */
interface PendingMutationContext {
  snapshots: Array<[readonly unknown[], Page<Expense> | undefined]>
}

/** GET /approvals/pending — expenses awaiting the current approver. */
export function usePendingApprovals(
  params: PendingParams,
  opts?: { enabled?: boolean },
): UseQueryResult<Page<Expense>, Error> {
  return useQuery({
    queryKey: approvalKeys.pending(params),
    queryFn: async () =>
      unwrapPage(await api.get<PaginatedResponse<Expense>>('/approvals/pending', { params })),
    enabled: opts?.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

/**
 * Optimistically drops the actioned expense from every cached pending page and
 * decrements its total, then returns the snapshots so onError can roll back.
 */
function makeOptimisticRemove(qc: ReturnType<typeof useQueryClient>) {
  return async (id: number): Promise<PendingMutationContext> => {
    await qc.cancelQueries({ queryKey: approvalKeys.pendingRoot })
    const entries = qc.getQueriesData<Page<Expense>>({ queryKey: approvalKeys.pendingRoot })
    const snapshots: PendingMutationContext['snapshots'] = entries.map(([key, data]) => [key, data])
    for (const [key, data] of entries) {
      if (!data) continue
      const remaining = data.items.filter((e) => e.id !== id)
      if (remaining.length === data.items.length) continue
      qc.setQueryData<Page<Expense>>(key, {
        ...data,
        items: remaining,
        total: Math.max(0, data.total - 1),
      })
    }
    return { snapshots }
  }
}

function rollback(
  qc: ReturnType<typeof useQueryClient>,
  context: PendingMutationContext | undefined,
): void {
  context?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data))
}

function invalidateAfterDecision(qc: ReturnType<typeof useQueryClient>, id: number): void {
  void qc.invalidateQueries({ queryKey: approvalKeys.pendingRoot })
  void qc.invalidateQueries({ queryKey: expenseKeys.detail(id) })
  // A decision flips an expense's status, so every list that can show it must
  // refetch — not just the pending queue. Mirrors the expense write mutations.
  void qc.invalidateQueries({ queryKey: expenseKeys.lists })
  void qc.invalidateQueries({ queryKey: adminKeys.expensesRoot })
  // The submitter's, manager's, and admin's roll-ups all shift on a decision;
  // invalidate them together (see invalidateAllStats' contract).
  invalidateAllStats(qc)
  void qc.invalidateQueries({ queryKey: notificationKeys.all })
}

/** PATCH /approvals/{id}/approve — optimistic removal from the pending list. */
export function useApproveExpense(): UseMutationResult<
  void,
  Error,
  number,
  PendingMutationContext
> {
  const qc = useQueryClient()
  const optimisticRemove = makeOptimisticRemove(qc)
  return useMutation({
    mutationFn: async (id: number) => {
      await api.patch(`/approvals/${id}/approve`)
    },
    onMutate: (id) => optimisticRemove(id),
    onError: (_err, _id, context) => rollback(qc, context),
    onSettled: (_data, _err, id) => invalidateAfterDecision(qc, id),
  })
}

/** PATCH /approvals/{id}/reject — optimistic removal from the pending list. */
export function useRejectExpense(): UseMutationResult<
  void,
  Error,
  { id: number; reason: string },
  PendingMutationContext
> {
  const qc = useQueryClient()
  const optimisticRemove = makeOptimisticRemove(qc)
  return useMutation({
    mutationFn: async ({ id, reason }) => {
      await api.patch(`/approvals/${id}/reject`, { reason })
    },
    onMutate: ({ id }) => optimisticRemove(id),
    onError: (_err, _vars, context) => rollback(qc, context),
    onSettled: (_data, _err, { id }) => invalidateAfterDecision(qc, id),
  })
}
