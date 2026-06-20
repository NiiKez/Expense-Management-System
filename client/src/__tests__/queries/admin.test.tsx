import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../helpers/renderWithProviders'
import type { Expense, User, AuditLog, AdminStats } from '../../types'
import { Category, Status, Role } from '../../types'

jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
jest.mock('@/services/api')
import api from '@/services/api'
import {
  useAdminStats,
  useAdminExpenses,
  useUsers,
  useAuditLogs,
  type AdminExpenseParams,
  type AuditLogParams,
} from '@/queries/admin'

const mockedApi = api as jest.Mocked<typeof api>

function makeWrapper() {
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

const adminStats: AdminStats = {
  orgSpendMonth: 1000,
  pendingOrgWide: 5,
  activeUsers: 12,
  approvedMonth: 8,
  baseCurrency: 'USD',
  byCategory: [],
  monthly: [],
}

const expense: Expense = {
  id: 1,
  submitted_by: 2,
  title: 'X',
  description: null,
  amount: 5,
  currency: 'USD',
  category: Category.OTHER,
  expense_date: '2024-02-01',
  status: Status.APPROVED,
  approved_by: 3,
  rejection_reason: null,
  version: 1,
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
}

const adminUser: User = {
  id: 3,
  entra_id: 'oid-3',
  email: 'm@b.com',
  display_name: 'Mgr',
  role: Role.MANAGER,
  manager_id: null,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const auditEntry: AuditLog = {
  id: 9,
  expense_id: 1,
  action: 'APPROVED',
  performed_by: 3,
  old_status: Status.PENDING,
  new_status: Status.APPROVED,
  details: null,
  ip_address: null,
  created_at: '2024-02-01T00:00:00Z',
}

beforeEach(() => jest.clearAllMocks())

describe('useAdminStats', () => {
  it('GETs /admin/stats', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: adminStats } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAdminStats(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/admin/stats')
    expect(result.current.data).toEqual(adminStats)
  })
})

describe('useAdminExpenses', () => {
  it('GETs /admin/expenses with params and normalizes the page', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: [expense], pagination: { total: 1, page: 1, pageSize: 20 } },
    })
    const { wrapper } = makeWrapper()
    const params: AdminExpenseParams = {
      page: 1,
      pageSize: 20,
      status: Status.APPROVED,
      date_from: '2024-01-01',
    }
    const { result } = renderHook(() => useAdminExpenses(params), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/admin/expenses', { params })
    expect(result.current.data?.items).toEqual([expense])
    expect(result.current.data?.total).toBe(1)
  })
})

describe('useUsers', () => {
  it('GETs /admin/users', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: [adminUser] } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUsers(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/admin/users')
    expect(result.current.data).toEqual([adminUser])
  })
})

describe('useAuditLogs', () => {
  it('GETs /admin/audit-logs with params and normalizes the page', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: [auditEntry], pagination: { total: 1, page: 1, pageSize: 20 } },
    })
    const { wrapper } = makeWrapper()
    const params: AuditLogParams = { page: 1, pageSize: 20, action: 'APPROVED' }
    const { result } = renderHook(() => useAuditLogs(params), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/admin/audit-logs', { params })
    expect(result.current.data?.items).toEqual([auditEntry])
  })
})
