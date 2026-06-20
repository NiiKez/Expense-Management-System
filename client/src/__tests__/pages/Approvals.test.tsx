import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockExpense } from '../helpers/factories'
import type { Expense, PaginatedResponse } from '../../types'

// The api module reaches the network at import time, and auth constructs MSAL
// (needs Web Crypto not in jsdom) — mock both per the migration contract.
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
import Approvals from '@/pages/Approvals'

const mockedApi = api as jest.Mocked<typeof api>

function pendingPage(items: Expense[]): { data: PaginatedResponse<Expense> } {
  return {
    data: {
      success: true,
      data: items,
      pagination: { total: items.length, page: 1, pageSize: 20 },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Approvals', () => {
  it('renders the pending approval items returned by the query', async () => {
    mockedApi.get.mockResolvedValue(
      pendingPage([
        mockExpense({ id: 1, title: 'Team Lunch' }),
        mockExpense({ id: 2, title: 'Conference Ticket' }),
      ]),
    )

    renderWithProviders(<Approvals />)

    expect(await screen.findByText('Team Lunch')).toBeInTheDocument()
    expect(screen.getByText('Conference Ticket')).toBeInTheDocument()
    expect(mockedApi.get).toHaveBeenCalledWith('/approvals/pending', {
      params: { page: 1, pageSize: 20 },
    })
  })

  it('approving an item PATCHes the approve endpoint and removes it from the list', async () => {
    const user = userEvent.setup()
    // Mirror the server: once an id is actioned it no longer comes back from the
    // pending endpoint, so the hook's post-mutation refetch returns the rest.
    const remaining = new Set([1, 2])
    mockedApi.get.mockImplementation(async () =>
      pendingPage(
        [
          mockExpense({ id: 1, title: 'Team Lunch' }),
          mockExpense({ id: 2, title: 'Conference Ticket' }),
        ].filter((e) => remaining.has(e.id)),
      ),
    )
    mockedApi.patch.mockImplementation(async (url: string) => {
      if (url === '/approvals/1/approve') remaining.delete(1)
      return { data: { success: true } }
    })

    renderWithProviders(<Approvals />)

    await screen.findByText('Team Lunch')
    await user.click(screen.getByTestId('approval-approve-1'))

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/approvals/1/approve'),
    )
    // Optimistic removal + refetch drops the actioned card from the list.
    await waitFor(() => expect(screen.queryByText('Team Lunch')).not.toBeInTheDocument())
    expect(screen.getByText('Conference Ticket')).toBeInTheDocument()
  })

  it('rejecting an item with a reason PATCHes the reject endpoint with that reason', async () => {
    const user = userEvent.setup()
    const remaining = new Set([1])
    mockedApi.get.mockImplementation(async () =>
      pendingPage(
        [mockExpense({ id: 1, title: 'Team Lunch' })].filter((e) => remaining.has(e.id)),
      ),
    )
    mockedApi.patch.mockImplementation(async (url: string) => {
      if (url === '/approvals/1/reject') remaining.delete(1)
      return { data: { success: true } }
    })

    renderWithProviders(<Approvals />)

    await screen.findByText('Team Lunch')

    // Open the inline reject form, supply a reason, confirm.
    await user.click(screen.getByTestId('approval-reject-1'))
    const reasonField = await screen.findByTestId('approval-reject-reason-1')
    await user.type(reasonField, 'Out of policy')
    await user.click(screen.getByTestId('approval-confirm-reject-1'))

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/approvals/1/reject', {
        reason: 'Out of policy',
      }),
    )
    await waitFor(() => expect(screen.queryByText('Team Lunch')).not.toBeInTheDocument())
  })
})
