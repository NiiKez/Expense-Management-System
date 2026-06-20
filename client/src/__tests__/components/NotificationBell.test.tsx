import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../helpers/renderWithProviders'

// Auto-mock the axios instance; mock the MSAL/auth module `@/services/api` loads.
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
import NotificationBell from '@/components/layout/NotificationBell'

const mockedApi = api as jest.Mocked<typeof api>

const NOTIF = {
  id: 1,
  user_id: 1,
  type: 'EXPENSE_APPROVED',
  expense_id: 7,
  actor_id: 2,
  message: 'Your expense was approved',
  is_read: 0,
  created_at: '2024-02-01T00:00:00Z',
}

// Route api.get by URL so the unread-count poll and the list fetch each return
// their documented response shapes.
function routeGet(url: string) {
  if (url === '/notifications/unread-count') {
    return Promise.resolve({ data: { success: true, data: { count: 3 } } })
  }
  if (url === '/notifications') {
    return Promise.resolve({
      data: { success: true, data: [NOTIF], meta: { unread: 3 } },
    })
  }
  return Promise.reject(new Error(`unexpected GET ${url}`))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedApi.get.mockImplementation((url: string) => routeGet(url))
  mockedApi.patch.mockResolvedValue({ data: { success: true } })
  mockedApi.post.mockResolvedValue({ data: { success: true } })
})

describe('NotificationBell', () => {
  it('renders the unread badge from the unread-count query', async () => {
    renderWithProviders(<NotificationBell />)

    const badge = await screen.findByTestId('notification-badge')
    expect(badge).toHaveTextContent('3')
    expect(mockedApi.get).toHaveBeenCalledWith('/notifications/unread-count')
  })

  it('fetches the list when the popover opens', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)

    await screen.findByTestId('notification-badge')
    // The list is gated on `open`; not fetched yet.
    expect(mockedApi.get).not.toHaveBeenCalledWith('/notifications', expect.anything())

    await user.click(screen.getByTestId('notification-bell'))

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith('/notifications', {
        params: { page: 1, pageSize: 10 },
      }),
    )
    expect(await screen.findByText('Your expense was approved')).toBeInTheDocument()
  })

  it('marks all read via POST /notifications/read-all', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)

    await screen.findByTestId('notification-badge')
    await user.click(screen.getByTestId('notification-bell'))

    const markAll = await screen.findByTestId('notification-mark-all')
    await user.click(markAll)

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/notifications/read-all'),
    )
  })
})
