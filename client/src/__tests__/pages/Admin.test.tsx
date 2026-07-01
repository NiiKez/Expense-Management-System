import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// jsdom lacks the pointer-capture / scroll APIs Radix Select calls; the tab
// panels render Radix triggers, so keep the polyfills in place for safety.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

// Admin mounts AdminExpenses / UserManagement / AuditLog, which all reach the
// network at import time. Stub the api instance, auth (MSAL), download + toast.
jest.mock('@/services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}))
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
jest.mock('@/lib/download', () => ({ downloadFile: jest.fn() }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
// UserManagement reads the current user via useAuth for the "you" badge.
jest.mock('@/context/AuthContext')

import api from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import Admin from '@/pages/Admin'
import { renderWithProviders, makeMockAuthValue } from '../helpers/renderWithProviders'
import { mockUser, mockExpense, mockPaginatedResponse } from '../helpers/factories'
import { Role } from '@/types'

const mockedGet = api.get as jest.Mock
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

const users = [mockUser({ id: 1, display_name: 'Alice Admin', role: Role.ADMIN })]

beforeEach(() => {
  jest.clearAllMocks()
  mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ id: 1, role: Role.ADMIN }) }))
  mockedGet.mockImplementation((url: string) => {
    if (url === '/admin/expenses') {
      return Promise.resolve({ data: mockPaginatedResponse([mockExpense({ id: 1, title: 'Team Lunch' })]) })
    }
    if (url === '/admin/users') {
      return Promise.resolve({ data: { success: true, data: users } })
    }
    if (url === '/admin/audit-logs') {
      return Promise.resolve({ data: { success: true, data: [], pagination: { total: 0, page: 1, pageSize: 20 } } })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
})

describe('Admin tabs', () => {
  it('shows the Expenses panel by default with its tab marked current', async () => {
    renderWithProviders(<Admin />)

    expect(screen.getByTestId('admin-tab-expenses')).toHaveAttribute('aria-current', 'page')
    // AdminExpenses owns the search box.
    expect(await screen.findByTestId('admin-filter-search')).toBeInTheDocument()
  })

  it('switches to the Users panel and unmounts the Expenses panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Admin />)
    await screen.findByTestId('admin-filter-search')

    await user.click(screen.getByTestId('admin-tab-users'))

    expect(screen.getByTestId('admin-tab-users')).toHaveAttribute('aria-current', 'page')
    // UserManagement owns the read-only Entra note…
    expect(
      await screen.findByText(/Roles are managed centrally in Entra ID App Roles/),
    ).toBeInTheDocument()
    // …and the Expenses panel is gone.
    expect(screen.queryByTestId('admin-filter-search')).not.toBeInTheDocument()
  })

  it('switches to the Audit log panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Admin />)
    await screen.findByTestId('admin-filter-search')

    await user.click(screen.getByTestId('admin-tab-audit'))

    expect(screen.getByTestId('admin-tab-audit')).toHaveAttribute('aria-current', 'page')
    // AuditLog owns the expense-ID filter.
    expect(await screen.findByLabelText('Filter by expense ID')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-filter-search')).not.toBeInTheDocument()
  })
})
