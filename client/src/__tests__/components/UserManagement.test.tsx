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

// The api instance and auth service both touch the network / Web Crypto at import
// time, so stub them before the component (transitively) imports them.
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
// Control the current user per the ProtectedRoute pattern (mock module, set return).
jest.mock('@/context/AuthContext')

import api from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import UserManagement from '@/components/admin/UserManagement'
import { renderWithProviders, makeMockAuthValue } from '../helpers/renderWithProviders'
import { mockUser } from '../helpers/factories'
import { Role } from '@/types'

const mockedGet = api.get as jest.Mock
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

const users = [
  mockUser({ id: 1, display_name: 'Alice Admin', email: 'alice@example.com', role: Role.ADMIN }),
  mockUser({ id: 2, display_name: 'Mona Manager', email: 'mona@example.com', role: Role.MANAGER }),
  mockUser({
    id: 3,
    display_name: 'Eddie Employee',
    email: 'eddie@example.com',
    role: Role.EMPLOYEE,
    manager_id: 2,
  }),
]

beforeEach(() => {
  jest.clearAllMocks()
  mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ id: 1 }) }))
  mockedGet.mockResolvedValue({ data: { success: true, data: users } })
})

describe('UserManagement', () => {
  it('fetches GET /admin/users and renders every user row', async () => {
    renderWithProviders(<UserManagement />)

    expect(await screen.findByText('Alice Admin')).toBeInTheDocument()
    expect(screen.getByText('Eddie Employee')).toBeInTheDocument()
    // Emails are unique per user; "Mona Manager" the name appears twice (her own
    // row + Eddie's resolved manager cell), so assert her presence by email.
    expect(screen.getByText('mona@example.com')).toBeInTheDocument()

    expect(mockedGet).toHaveBeenCalledWith('/admin/users')

    // Manager-name resolution: Eddie's manager_id (2) → "Mona Manager".
    const eddieRow = screen.getByText('Eddie Employee').closest('tr') as HTMLElement
    expect(within(eddieRow).getByText('Mona Manager')).toBeInTheDocument()

    // Computed counts.
    expect(screen.getByText('3 users total')).toBeInTheDocument()
    expect(screen.getByText('1 admin · 1 manager · 1 employee')).toBeInTheDocument()

    // The read-only note is preserved.
    expect(
      screen.getByText(/Roles are managed centrally in Entra ID App Roles\. This view is read-only\./),
    ).toBeInTheDocument()
  })

  it('narrows rows by the role filter', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UserManagement />)
    await screen.findByText('Alice Admin')

    await user.click(screen.getByLabelText('Filter by role'))
    await user.click(screen.getByRole('option', { name: 'Manager' }))

    await waitFor(() => expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument())
    expect(screen.getByText('Mona Manager')).toBeInTheDocument()
    expect(screen.queryByText('Eddie Employee')).not.toBeInTheDocument()
  })

  it('narrows rows by the search box (name or email)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UserManagement />)
    await screen.findByText('Alice Admin')

    await user.type(screen.getByLabelText('Search users'), 'eddie@example.com')

    await waitFor(() => expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument())
    expect(screen.getByText('Eddie Employee')).toBeInTheDocument()
    // Mona's own row is filtered out (her email no longer renders) even though her
    // name still appears as Eddie's resolved manager.
    expect(screen.queryByText('mona@example.com')).not.toBeInTheDocument()
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
  })

  it('badges the current user\'s own row with "you"', async () => {
    // beforeEach sets the current user to id 1 (Alice Admin).
    renderWithProviders(<UserManagement />)

    const aliceRow = (await screen.findByText('Alice Admin')).closest('tr') as HTMLElement
    expect(within(aliceRow).getByText('you')).toBeInTheDocument()

    // Another user's row carries no self badge.
    const monaRow = screen.getByText('mona@example.com').closest('tr') as HTMLElement
    expect(within(monaRow).queryByText('you')).not.toBeInTheDocument()
  })

  it('renders Active / Inactive status badges per user', async () => {
    mockedGet.mockResolvedValue({
      data: {
        success: true,
        data: [
          mockUser({ id: 1, display_name: 'Alice Admin', email: 'alice@example.com', role: Role.ADMIN, is_active: true }),
          mockUser({ id: 4, display_name: 'Gone Guy', email: 'gone@example.com', role: Role.EMPLOYEE, is_active: false }),
        ],
      },
    })
    renderWithProviders(<UserManagement />)

    const activeRow = (await screen.findByText('Alice Admin')).closest('tr') as HTMLElement
    expect(within(activeRow).getByText('Active')).toBeInTheDocument()

    const inactiveRow = screen.getByText('Gone Guy').closest('tr') as HTMLElement
    expect(within(inactiveRow).getByText('Inactive')).toBeInTheDocument()
  })

  it('shows the error state with a Try again button that refetches', async () => {
    mockedGet.mockReset()
    mockedGet.mockRejectedValueOnce(new Error('boom'))
    renderWithProviders(<UserManagement />)

    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText('Couldn’t load users')).toBeInTheDocument()

    // From here the request succeeds; Try again must refetch and render rows.
    mockedGet.mockResolvedValue({ data: { success: true, data: users } })
    await userEvent.click(retry)

    expect(await screen.findByText('Alice Admin')).toBeInTheDocument()
  })
})
