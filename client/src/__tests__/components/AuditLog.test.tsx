import React from 'react'
import { screen, waitFor, within } from '@testing-library/react'
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
// Toasts are asserted (export failure); mock so no <Toaster> is required.
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

import api from '@/services/api'
import { downloadFile } from '@/lib/download'
import { toast } from 'sonner'
import AuditLog from '@/components/admin/AuditLog'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockUser } from '../helpers/factories'
import { Role, Status } from '@/types'
import type { AuditLog as AuditLogEntry } from '@/types'

const mockedGet = api.get as jest.Mock
const mockedDownload = downloadFile as jest.Mock
const mockedToastError = toast.error as jest.Mock

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

// Same as installDefaultMocks but with caller-supplied audit rows + total, so a
// test can drive the readable-details / empty / pagination branches directly.
function installMocks(
  auditLogs: AuditLogEntry[],
  total = auditLogs.length,
) {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/admin/users') {
      return Promise.resolve({ data: { success: true, data: users } })
    }
    if (url === '/admin/audit-logs') {
      return Promise.resolve({
        data: { success: true, data: auditLogs, pagination: { total, page: 1, pageSize: 20 } },
      })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

// Builds one audit row, defaulting the boilerplate fields so tests name only the
// bits under test (e.g. the `details` shape feeding readableDetails).
function makeLog(overrides: Partial<AuditLogEntry> & { id: number }): AuditLogEntry {
  return {
    expense_id: 1,
    action: 'UPDATED',
    performed_by: 2,
    old_status: null,
    new_status: null,
    details: null,
    ip_address: null,
    created_at: '2024-02-01T00:00:00Z',
    ...overrides,
  }
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

describe('AuditLog readableDetails', () => {
  // Each row exercises a distinct branch of readableDetails; assert the exact
  // human-readable summary rendered in the Details cell.
  it('renders a concise summary per detail shape', async () => {
    installMocks([
      makeLog({ id: 1, action: 'REJECTED', details: { rejection_reason: '  Over budget  ' } }),
      makeLog({ id: 2, action: 'REJECTED', details: { reason: 'Duplicate claim' } }),
      makeLog({ id: 3, action: 'OVERRIDDEN', details: { override_from: 100, override_to: 250 } }),
      makeLog({ id: 4, action: 'UPDATED', details: { amount: 88 } }),
      makeLog({ id: 5, action: 'UPDATED', details: { updated_fields: ['title', 'version', 'updated_at', 'category'] } }),
      makeLog({ id: 6, action: 'UPDATED', details: { title: 'Quarterly offsite' } }),
      // amount + title → the two parts are joined with " · ".
      makeLog({ id: 7, action: 'UPDATED', details: { amount: 20, title: 'Taxi' } }),
    ])
    renderWithProviders(<AuditLog />)

    // Rejection reason (trimmed + quoted); the `reason` alias resolves too.
    expect(await screen.findByText('Reason: "Over budget"')).toBeInTheDocument()
    expect(screen.getByText('Reason: "Duplicate claim"')).toBeInTheDocument()
    // Override old→new amount.
    expect(screen.getByText('Override: 100 → 250')).toBeInTheDocument()
    // Bare changed amount (override_from absent).
    expect(screen.getByText('Amount: 88')).toBeInTheDocument()
    // updated_fields lists field names, dropping version/updated_at noise.
    expect(screen.getByText('Fields changed: title, category')).toBeInTheDocument()
    // Title change (quoted).
    expect(screen.getByText('Title: "Quarterly offsite"')).toBeInTheDocument()
    // Multiple parts joined by the separator.
    expect(screen.getByText('Amount: 20 · Title: "Taxi"')).toBeInTheDocument()
  })

  it('falls back to a dash when details carry nothing summarisable', async () => {
    installMocks([
      // Empty object → no parts.
      makeLog({ id: 1, expense_id: 500, details: {} }),
      // updated_fields with only filtered-out noise → no parts.
      makeLog({ id: 2, expense_id: 501, details: { updated_fields: ['version', 'updated_at'] } }),
    ])
    renderWithProviders(<AuditLog />)

    // Both rows render the em-dash placeholder in their Details cell.
    const row1 = (await screen.findByText('#0500')).closest('tr') as HTMLElement
    const row2 = (screen.getByText('#0501')).closest('tr') as HTMLElement
    // Details is the 5th cell (Expense, Action, Performed by, Status change, Details, When).
    expect(within(row1).getAllByText('—').length).toBeGreaterThan(0)
    expect(within(row2).getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('AuditLog status-change cell', () => {
  it('labels the old→new transition for assistive tech and shows both badges', async () => {
    installMocks([
      makeLog({ id: 1, expense_id: 42, old_status: Status.PENDING, new_status: Status.APPROVED }),
      // No status change → the cell carries no aria-label and renders a dash.
      makeLog({ id: 2, expense_id: 43, old_status: null, new_status: null }),
    ])
    renderWithProviders(<AuditLog />)

    const cell = await screen.findByLabelText('Status changed from PENDING to APPROVED')
    // Both StatusBadges render their raw uppercase status text inside the cell.
    expect(within(cell).getByText('PENDING')).toBeInTheDocument()
    expect(within(cell).getByText('APPROVED')).toBeInTheDocument()

    // The no-transition row has no such labelled cell.
    expect(
      screen.queryByLabelText('Status changed from none to none'),
    ).not.toBeInTheDocument()
  })
})

describe('AuditLog sorting', () => {
  it('adds sort + order params (desc first) and resets to page 1 on a header click', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AuditLog />)
    await screen.findByText('Mona Manager')

    await user.click(screen.getByTestId('sort-when'))

    await waitFor(() => {
      const sorted = auditCalls().filter(
        (c) => auditParamsOf(c)?.sort === 'when' && auditParamsOf(c)?.order === 'desc',
      )
      expect(sorted.length).toBeGreaterThan(0)
    })
    expect(auditParamsOf(auditCalls().at(-1) as unknown[])).toMatchObject({ page: 1 })
  })
})

describe('AuditLog pagination', () => {
  it('advances to the next page and disables Previous on page 1', async () => {
    const user = userEvent.setup()
    // 45 rows over pageSize 20 → 3 pages.
    installMocks(logs, 45)
    renderWithProviders(<AuditLog />)
    await screen.findByText('Mona Manager')

    const prev = screen.getByRole('button', { name: /Previous/ })
    expect(prev).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Next/ }))

    await waitFor(() => {
      expect(auditCalls().some((c) => auditParamsOf(c)?.page === 2)).toBe(true)
    })
    // Off page 1, Previous is now enabled.
    expect(screen.getByRole('button', { name: /Previous/ })).toBeEnabled()
  })
})

describe('AuditLog export', () => {
  it('exports CSV with the active filters via downloadFile', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AuditLog />)
    await screen.findByText('Mona Manager')

    // Apply an action filter, then export — the file must carry that filter.
    await user.click(screen.getByLabelText('Filter by action'))
    await user.click(screen.getByRole('option', { name: 'Approved' }))

    await user.click(screen.getByTestId('export-csv'))

    await waitFor(() => expect(mockedDownload).toHaveBeenCalled())
    expect(mockedDownload).toHaveBeenCalledWith(
      '/admin/audit-logs/export',
      expect.objectContaining({ action: 'APPROVED' }),
      'audit-logs.csv',
    )
  })

  it('toasts an error when the export download fails', async () => {
    const user = userEvent.setup()
    mockedDownload.mockRejectedValueOnce(new Error('network'))
    renderWithProviders(<AuditLog />)
    await screen.findByText('Mona Manager')

    await user.click(screen.getByTestId('export-csv'))

    await waitFor(() =>
      expect(mockedToastError).toHaveBeenCalledWith('Failed to export audit log.'),
    )
  })
})

describe('AuditLog error + empty states', () => {
  it('shows the error state with a Try again button that refetches', async () => {
    // First audit-logs request fails; users still resolves.
    mockedGet.mockImplementation((url: string) => {
      if (url === '/admin/users') return Promise.resolve({ data: { success: true, data: users } })
      if (url === '/admin/audit-logs') return Promise.reject(new Error('boom'))
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    renderWithProviders(<AuditLog />)

    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText('Couldn’t load the audit trail')).toBeInTheDocument()

    // From here the request succeeds; Try again must refetch and render rows.
    installMocks(logs)
    await userEvent.click(retry)

    expect(await screen.findByText('Mona Manager')).toBeInTheDocument()
  })

  it('shows the neutral empty state with no filters applied', async () => {
    installMocks([], 0)
    renderWithProviders(<AuditLog />)

    expect(await screen.findByText('No audit entries')).toBeInTheDocument()
    expect(screen.getByText('No activity has been recorded yet.')).toBeInTheDocument()
  })

  it('shows the filtered empty state once a filter is active', async () => {
    const user = userEvent.setup()
    installMocks([], 0)
    renderWithProviders(<AuditLog />)
    await screen.findByText('No audit entries')

    // Typing an expense-id makes hasFilters true → the copy switches.
    await user.type(screen.getByLabelText('Filter by expense ID'), '7')

    expect(
      await screen.findByText('No audit entries match the current filters.'),
    ).toBeInTheDocument()
  })
})
