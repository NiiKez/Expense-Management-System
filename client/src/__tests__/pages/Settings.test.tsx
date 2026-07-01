import React from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../helpers/renderWithProviders'

// jsdom lacks the pointer-capture / scroll APIs Radix Select calls when opening
// its listbox (the currency picker). Polyfill them so its options can be clicked.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

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
// Save success/failure surface as toasts; mock so no <Toaster> is required.
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

import api from '@/services/api'
import { toast } from 'sonner'
import Settings from '@/pages/Settings'

const mockedApi = api as jest.Mocked<typeof api>
const mockedToastSuccess = toast.success as jest.Mock
const mockedToastError = toast.error as jest.Mock

// Resolves /me from ME and /me/directory from `directory` (default: an empty
// directory, which still renders the OrgDirectory section — as opposed to the
// isError branch, which hides it). Persistent so refetches keep resolving.
function installMeMocks(me: typeof ME = ME, directory: unknown = {}) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/me') return Promise.resolve({ data: { success: true, data: me } })
    if (url === '/me/directory') return Promise.resolve({ data: { success: true, data: directory } })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

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

  it('renders the OrgDirectory (reporting line + groups) from useMyDirectory', async () => {
    // A resolving /me/directory keeps OrgDirectory out of its isError→null branch.
    installMeMocks(ME, {
      orgAttributes: { department: null, jobTitle: null, employeeId: null, officeLocation: null },
      managerChain: [
        { id: 'g1', displayName: 'Dana Director', jobTitle: 'Director', department: 'Ops' },
      ],
      groups: [{ id: 'grp1', name: 'Engineering' }],
    })
    renderWithProviders(<Settings />)

    await screen.findByText('Alice Example')
    // The reporting-line section only exists when OrgDirectory renders (not null).
    const reporting = await screen.findByTestId('reporting-line')
    expect(within(reporting).getByText('Dana Director')).toBeInTheDocument()
    const groups = screen.getByTestId('profile-groups')
    expect(within(groups).getByText('Engineering')).toBeInTheDocument()
  })

  it('PATCHes the chosen currency in the preferences body', async () => {
    const user = userEvent.setup()
    installMeMocks() // ME.default_currency === 'USD'
    mockedApi.patch.mockResolvedValueOnce({ data: { success: true, data: { ...ME } } })

    renderWithProviders(<Settings />)
    const saveBtn = await screen.findByTestId('settings-save')
    expect(saveBtn).toBeDisabled()

    // Open the Radix currency select and pick EUR.
    await user.click(screen.getByTestId('pref-currency'))
    await user.click(await screen.findByRole('option', { name: 'EUR' }))

    await waitFor(() => expect(saveBtn).toBeEnabled())
    await user.click(saveBtn)

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me/preferences', {
        default_currency: 'EUR',
        notify_on_submission: true,
        notify_on_decision: true,
        notify_on_comment: true,
      }),
    )
  })

  it('maps the "No preference" option to a null default_currency', async () => {
    const user = userEvent.setup()
    installMeMocks() // starts on 'USD'
    mockedApi.patch.mockResolvedValueOnce({ data: { success: true, data: { ...ME } } })

    renderWithProviders(<Settings />)
    const saveBtn = await screen.findByTestId('settings-save')

    await user.click(screen.getByTestId('pref-currency'))
    await user.click(await screen.findByRole('option', { name: 'No preference (USD)' }))

    await waitFor(() => expect(saveBtn).toBeEnabled())
    await user.click(saveBtn)

    // The sentinel maps to null on the wire (server falls back to the org currency).
    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        '/me/preferences',
        expect.objectContaining({ default_currency: null }),
      ),
    )
  })

  it('toasts success and re-seeds the form (Save re-disables) after a save', async () => {
    const user = userEvent.setup()
    installMeMocks()
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
    const saveBtn = await screen.findByTestId('settings-save')

    await user.click(screen.getByTestId('pref-notify-submission'))
    await waitFor(() => expect(saveBtn).toBeEnabled())
    await user.click(saveBtn)

    await waitFor(() => expect(mockedToastSuccess).toHaveBeenCalledWith('Settings saved.'))
    // The form re-seeds from the saved payload → pristine again → Save disabled.
    await waitFor(() => expect(saveBtn).toBeDisabled())
  })

  it('toasts an error when the save request fails', async () => {
    const user = userEvent.setup()
    installMeMocks()
    mockedApi.patch.mockRejectedValueOnce(new Error('boom'))

    renderWithProviders(<Settings />)
    const saveBtn = await screen.findByTestId('settings-save')

    await user.click(screen.getByTestId('pref-notify-decision'))
    await waitFor(() => expect(saveBtn).toBeEnabled())
    await user.click(saveBtn)

    await waitFor(() =>
      expect(mockedToastError).toHaveBeenCalledWith(
        'Could not save your settings. Please try again.',
      ),
    )
  })
})
