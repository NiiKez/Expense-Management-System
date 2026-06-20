import {
  useQuery,
  keepPreviousData,
  type UseQueryResult,
} from '@tanstack/react-query'
import api from '@/services/api'
import type {
  ApiResponse,
  PaginatedResponse,
  AdminStats,
  Expense,
  User,
  AuditLog,
} from '@/types'
import { unwrapData, unwrapPage, type Page } from './utils'

/** Query keys for the admin module. */
export const adminKeys = {
  all: ['admin'] as const,
  stats: ['admin', 'stats'] as const,
  expenses: (params: AdminExpenseParams) => ['admin', 'expenses', params] as const,
  expensesRoot: ['admin', 'expenses'] as const,
  users: ['admin', 'users'] as const,
  auditLogs: (params: AuditLogParams) => ['admin', 'audit-logs', params] as const,
  auditLogsRoot: ['admin', 'audit-logs'] as const,
}

export interface AdminExpenseParams {
  page: number
  pageSize: number
  search?: string
  status?: string
  category?: string
  date_from?: string
  date_to?: string
  sort?: string
  order?: string
}

export interface AuditLogParams {
  page: number
  pageSize: number
  expense_id?: string
  performed_by?: string
  action?: string
  date_from?: string
  date_to?: string
  sort?: string
  order?: string
}

/** GET /admin/stats — org-wide dashboard summary. */
export function useAdminStats(opts?: { enabled?: boolean }): UseQueryResult<AdminStats, Error> {
  return useQuery({
    queryKey: adminKeys.stats,
    queryFn: async () => unwrapData(await api.get<ApiResponse<AdminStats>>('/admin/stats')),
    enabled: opts?.enabled ?? true,
  })
}

/** GET /admin/expenses — org-wide expense list with filters/sort/pagination. */
export function useAdminExpenses(
  params: AdminExpenseParams,
  opts?: { enabled?: boolean },
): UseQueryResult<Page<Expense>, Error> {
  return useQuery({
    queryKey: adminKeys.expenses(params),
    queryFn: async () =>
      unwrapPage(await api.get<PaginatedResponse<Expense>>('/admin/expenses', { params })),
    enabled: opts?.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

/** GET /admin/users — every user in the org (for management + name resolution). */
export function useUsers(opts?: { enabled?: boolean }): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: async () => unwrapData(await api.get<ApiResponse<User[]>>('/admin/users')),
    enabled: opts?.enabled ?? true,
  })
}

/** GET /admin/audit-logs — audit trail with filters/sort/pagination. */
export function useAuditLogs(
  params: AuditLogParams,
  opts?: { enabled?: boolean },
): UseQueryResult<Page<AuditLog>, Error> {
  return useQuery({
    queryKey: adminKeys.auditLogs(params),
    queryFn: async () =>
      unwrapPage(await api.get<PaginatedResponse<AuditLog>>('/admin/audit-logs', { params })),
    enabled: opts?.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}
