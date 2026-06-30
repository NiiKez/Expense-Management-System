import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../helpers/renderWithProviders'

// Mock the axios instance (auto-mock gives jest.fn() for get/patch/etc.) and the
// MSAL/auth module that `@/services/api` imports at module load.
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

import api from '@/services/api'
import Settings from '@/pages/Settings'

const mockedApi = api as jest.Mocked<typeof api>

const ME = {
  id: 1,
  entra_id: 'oid-1',
  email: 'alice@example.com',
  display_name: 'Alice Example',
  role: 'EMPLOYEE',
  manager_id: null,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  manager_name: 'Bob Manager',
  default_currency: 'USD',
  notify_on_submission: true,
  notify_on_decision: true,
  notify_on_comment: true,
}

beforeEach(() => jest.clearAllMocks())

describe('Settings', () => {
  it('renders the read-only profile from useMe', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: ME } })

    renderWithProviders(<Settings />)

    expect(await screen.findByText('Alice Example')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    // Manager is rendered in the read-only profile block.
    expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    expect(mockedApi.get).toHaveBeenCalledWith('/me')
  })

  it('shows all held roles (active one marked) when the user holds more than one', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: { ...ME, role: 'MANAGER', roles: ['MANAGER', 'EMPLOYEE'] } },
    })

    renderWithProviders(<Settings />)

    await screen.findByText('Alice Example')
    const roles = screen.getByTestId('profile-roles')
    expect(roles).toBeInTheDocument()
    expect(screen.getByTestId('profile-role-MANAGER')).toBeInTheDocument()
    expect(screen.getByTestId('profile-role-EMPLOYEE')).toBeInTheDocument()
    // The active role is rendered with the filled (default) badge variant.
    expect(screen.getByTestId('profile-role-MANAGER')).toHaveAttribute('data-variant', 'default')
    expect(screen.getByTestId('profile-role-EMPLOYEE')).toHaveAttribute('data-variant', 'outline')
  })

  it('saves toggled preferences via PATCH /me/preferences', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: ME } })
    mockedApi.patch.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          default_currency: 'USD',
          notify_on_submission: false,
          notify_on_decision: true,
          notify_on_comment: true,
        },
      },
    })

    renderWithProviders(<Settings />)

    // Wait for the form to hydrate from useMe.
    const saveBtn = await screen.findByTestId('settings-save')
    // Pristine form → Save disabled.
    expect(saveBtn).toBeDisabled()

    // Toggle a notification preference off; the form becomes dirty.
    await user.click(screen.getByTestId('pref-notify-submission'))
    await waitFor(() => expect(saveBtn).toBeEnabled())

    await user.click(saveBtn)

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me/preferences', {
        default_currency: 'USD',
        notify_on_submission: false,
        notify_on_decision: true,
        notify_on_comment: true,
      }),
    )
  })
})
