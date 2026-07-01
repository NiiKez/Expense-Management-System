import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The axios instance and the auth module both touch the network / MSAL at import
// time; mock them per the migration contract. ManagerEmployees calls `api.get`
// directly (raw useState, not react-query), so we drive its states off this mock.
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

import api from '@/services/api'
import { Role } from '@/types'
import type { ManagerEmployee, ResponseMeta } from '@/types'
import ManagerEmployees from '@/pages/ManagerEmployees'
import { renderWithProviders } from '../helpers/renderWithProviders'

const mockedGet = api.get as jest.Mock

// Minimal ManagerEmployee builder — there is no shared factory for this shape.
function mockManagerEmployee(over: Partial<ManagerEmployee> = {}): ManagerEmployee {
  return {
    id: 'oid-1',
    displayName: 'Alice Example',
    mail: 'alice@example.com',
    userPrincipalName: 'alice@example.com',
    jobTitle: 'Engineer',
    department: 'Platform',
    appUser: {
      id: 1,
      email: 'alice@example.com',
      display_name: 'Alice Example',
      role: Role.ADMIN,
      manager_id: null,
      is_active: true,
    },
    ...over,
  }
}

function ok(data: ManagerEmployee[], meta?: ResponseMeta) {
  return { data: { success: true, data, meta } }
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('ManagerEmployees', () => {
  it('shows the loading skeleton and disables Refresh while the first load is in flight', () => {
    // A promise that never settles keeps the component in its initial loading state.
    mockedGet.mockReturnValue(new Promise(() => {}))
    renderWithProviders(<ManagerEmployees />)

    expect(screen.getByText('Loading team…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  })

  it('shows an error message when the request fails', async () => {
    mockedGet.mockRejectedValue(new Error('boom'))
    renderWithProviders(<ManagerEmployees />)

    expect(await screen.findByText('Failed to load your team directory.')).toBeInTheDocument()
  })

  it('shows the Graph-flavoured empty state when Graph returns no reports', async () => {
    mockedGet.mockResolvedValue(ok([], { source: 'graph' }))
    renderWithProviders(<ManagerEmployees />)

    expect(await screen.findByText('No direct reports')).toBeInTheDocument()
    expect(
      screen.getByText('Microsoft Graph returned no direct reports for your account.'),
    ).toBeInTheDocument()
  })

  it('shows the manager-relationship empty state when there is no Graph source', async () => {
    mockedGet.mockResolvedValue(ok([]))
    renderWithProviders(<ManagerEmployees />)

    expect(await screen.findByText('No direct reports')).toBeInTheDocument()
    expect(
      screen.getByText('No employees were found for your manager relationship.'),
    ).toBeInTheDocument()
  })

  it('renders the team table with role/status badges and — fallbacks', async () => {
    mockedGet.mockResolvedValue(
      ok([
        mockManagerEmployee({ id: 'oid-1', displayName: 'Alice Example' }),
        // Sparse row: no title/department/mail and no synced app user → four
        // em-dashes plus the "Not synced" status.
        mockManagerEmployee({
          id: 'oid-2',
          displayName: 'Bob Minimal',
          mail: null,
          jobTitle: null,
          department: null,
          appUser: null,
        }),
        // Inactive synced user → "Inactive" status and the Manager role label.
        mockManagerEmployee({
          id: 'oid-3',
          displayName: 'Carol Lead',
          jobTitle: 'Lead',
          department: 'Ops',
          appUser: {
            id: 3,
            email: 'carol@example.com',
            display_name: 'Carol Lead',
            role: Role.MANAGER,
            manager_id: null,
            is_active: false,
          },
        }),
      ]),
    )
    renderWithProviders(<ManagerEmployees />)

    expect(await screen.findByText('Alice Example')).toBeInTheDocument()
    expect(screen.getByText('Bob Minimal')).toBeInTheDocument()
    expect(screen.getByText('Carol Lead')).toBeInTheDocument()

    // Role labels come from formatCategory(role); status from is_active / appUser.
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Manager')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByText('Not synced')).toBeInTheDocument()

    // Bob's four blanks (title, department, mail, role) each render an em-dash.
    expect(screen.getAllByText('—')).toHaveLength(4)

    // Footer count pluralises.
    expect(screen.getByText('3 members')).toBeInTheDocument()
  })

  it('initial load calls /manager/employees without a forceRefresh param', async () => {
    mockedGet.mockResolvedValue(ok([mockManagerEmployee()]))
    renderWithProviders(<ManagerEmployees />)

    await screen.findByText('Alice Example')
    expect(mockedGet).toHaveBeenCalledWith('/manager/employees', { params: undefined })
  })

  it('Refresh refetches with forceRefresh=true', async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue(ok([mockManagerEmployee()]))
    renderWithProviders(<ManagerEmployees />)

    await screen.findByText('Alice Example')
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh).toBeEnabled()

    await user.click(refresh)
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/manager/employees', {
        params: { forceRefresh: true },
      }),
    )
  })
})
