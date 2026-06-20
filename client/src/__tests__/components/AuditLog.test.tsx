import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// jsdom lacks the pointer-capture / scroll APIs Radix Select calls when opening
// its listbox. Polyfill them so the dropdown options can be clicked in tests.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

jest.mock('@/services/api')
jest.mock('@/services/auth', () => ({
  msalInstance: {
    getActiveAccount: () => null,
    getAllAccounts: () => [],
    acquireTokenSilent: jest.fn(),
    acquireTokenRedirect: jest.fn(),
  },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
// CSV export goes through the download helper; keep it inert in tests.
jest.mock('@/lib/download', () => ({ downloadFile: jest.fn() }))

import api from '@/services/api'
import AuditLog from '@/components/admin/AuditLog'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockUser } from '../helpers/factories'
import { Role, Status } from '@/types'
import type { AuditLog as AuditLogEntry } from '@/types'

const mockedGet = api.get as jest.Mock

const users = [
  mockUser({ id: 1, display_name: 'Alice Admin', email: 'alice@example.com', role: Role.ADMIN }),
  mockUser({ id: 2, display_name: 'Mona Manager', email: 'mona@example.com', role: Role.MANAGER }),
]

const logs: AuditLogEntry[] = [
  {
    id: 10,
    expense_id: 42,
    action: 'APPROVED',
    performed_by: 2,
    old_status: Status.PENDING,
    new_status: Status.APPROVED,
    details: null,
    ip_address: null,
    created_at: '2024-02-01T00:00:00Z',
  },
  {
    id: 11,
    expense_id: 43,
    action: 'SUBMITTED',
    // Unknown performer → "User #99" fallback.
    performed_by: 99,
    old_status: null,
    new_status: Status.PENDING,
    details: null,
    ip_address: null,
    created_at: '2024-02-02T00:00:00Z',
  },
]

// Resolves /admin/users and /admin/audit-logs from the same api.get mock,
// returning a paginated envelope for the logs and a plain list for users.
function installDefaultMocks() {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/admin/users') {
      return Promise.resolve({ data: { success: true, data: users } })
    }
    if (url === '/admin/audit-logs') {
      return Promise.resolve({
        data: { success: true, data: logs, pagination: { total: logs.length, page: 1, pageSize: 20 } },
      })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

// The params object handed to api.get('/admin/audit-logs', { params }).
function auditParamsOf(call: unknown[]): Record<string, unknown> | undefined {
  const cfg = call[1] as { params?: Record<string, unknown> } | undefined
  return cfg?.params
}

function auditCalls() {
  return mockedGet.mock.calls.filter((c) => c[0] === '/admin/audit-logs')
}

beforeEach(() => {
  jest.clearAllMocks()
  installDefaultMocks()
})

describe('AuditLog', () => {
  it('renders log rows and resolves actor names from useUsers', async () => {
    renderWithProviders(<AuditLog />)

    // Both endpoints requested.
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/admin/users'))
    expect(mockedGet).toHaveBeenCalledWith('/admin/audit-logs', { params: { page: 1, pageSize: 20 } })

    // Known performer (id 2) resolves to the display name…
    expect(await screen.findByText('Mona Manager')).toBeInTheDocument()
    // …unknown performer (id 99) falls back to "User #99".
    expect(screen.getByText('User #99')).toBeInTheDocument()

    // Expense ids render zero-padded.
    expect(screen.getByText('#0042')).toBeInTheDocument()
  })

  it('requests new params when a filter changes (and resets page to 1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AuditLog />)

    await screen.findByText('Mona Manager')
    const before = auditCalls().length

    await user.click(screen.getByLabelText('Filter by action'))
    await user.click(screen.getByRole('option', { name: 'Approved' }))

    await waitFor(() => {
      const match = auditCalls().filter((c) => auditParamsOf(c)?.action === 'APPROVED')
      expect(match).toHaveLength(1)
    })

    // A new request was issued with page reset to 1.
    const last = auditCalls().at(-1)
    expect(auditParamsOf(last as unknown[])).toMatchObject({ page: 1, action: 'APPROVED' })
    expect(auditCalls().length).toBeGreaterThan(before)
  })

  it('debounces the expense-id filter into a single trailing request', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AuditLog />)
    await screen.findByText('Mona Manager')

    await user.type(screen.getByLabelText('Filter by expense ID'), '42')

    await waitFor(() => {
      const full = auditCalls().filter((c) => auditParamsOf(c)?.expense_id === '42')
      expect(full).toHaveLength(1)
    })

    // No per-keystroke '4' request leaked through.
    const partials = auditCalls().filter((c) => auditParamsOf(c)?.expense_id === '4')
    expect(partials).toHaveLength(0)
  })
})
