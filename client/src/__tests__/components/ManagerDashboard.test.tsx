import React from 'react'
import { screen, waitFor } from '@testing-library/react'

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub

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
import ManagerDashboard from '@/components/dashboard/ManagerDashboard'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockExpense } from '../helpers/factories'
import type { ManagerStats } from '@/types'

const mockedGet = api.get as jest.Mock

const stats: ManagerStats = {
  pendingApprovals: 5,
  teamSize: 9,
  teamSpendMonth: 4200,
  approvedMonth: 3100,
  baseCurrency: 'USD',
  byCategory: [],
  monthly: [],
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedGet.mockImplementation((url: string) => {
    if (url === '/manager/stats') {
      return Promise.resolve({ data: { success: true, data: stats } })
    }
    if (url === '/approvals/pending') {
      return Promise.resolve({
        data: {
          success: true,
          data: [
            mockExpense({ id: 21, title: 'Conference Tickets', submitter_name: 'Bob' }),
            mockExpense({ id: 22, title: 'Hotel Stay', submitter_name: 'Carol' }),
          ],
          pagination: { total: 2, page: 1, pageSize: 5 },
        },
      })
    }
    return Promise.reject(new Error(`unexpected url ${url}`))
  })
})

describe('ManagerDashboard', () => {
  it('renders key stat values and pending approval rows from the hooks', async () => {
    renderWithProviders(<ManagerDashboard />)

    // Key stat values (non-currency, locale-stable).
    expect(await screen.findByText('5')).toBeInTheDocument() // Pending approvals
    expect(screen.getByText('9')).toBeInTheDocument() // Team size
    expect(screen.getByText('Pending approvals', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Team size')).toBeInTheDocument()

    // A couple of pending rows render in the preview list.
    await waitFor(() => {
      expect(screen.getByText('Conference Tickets')).toBeInTheDocument()
    })
    expect(screen.getByText('Hotel Stay')).toBeInTheDocument()
  })

  it('renders skeleton placeholders while the queries are pending', () => {
    mockedGet.mockReset()
    mockedGet.mockReturnValue(new Promise(() => {})) // never resolves → stays pending

    const { container } = renderWithProviders(<ManagerDashboard />)

    // The stat + list skeletons render; the resolved happy content does not yet.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Team size')).not.toBeInTheDocument()
  })

  it('shows the "Could not load stats" empty state when the stats query errors', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/manager/stats') return Promise.reject(new Error('boom'))
      // Keep the list happy so we isolate the stats failure.
      return Promise.resolve({ data: { success: true, data: [], pagination: { total: 0, page: 1, pageSize: 5 } } })
    })

    renderWithProviders(<ManagerDashboard />)

    expect(await screen.findByText('Could not load stats')).toBeInTheDocument()
  })

  it('shows the list error empty state when the pending-approvals query errors', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/manager/stats') return Promise.resolve({ data: { success: true, data: stats } })
      if (url === '/approvals/pending') return Promise.reject(new Error('boom'))
      return Promise.reject(new Error(`unexpected url ${url}`))
    })

    renderWithProviders(<ManagerDashboard />)

    expect(await screen.findByText('Could not load pending approvals')).toBeInTheDocument()
  })

  it('shows the empty-list state when there are no pending approvals', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/manager/stats') return Promise.resolve({ data: { success: true, data: stats } })
      if (url === '/approvals/pending') {
        return Promise.resolve({ data: { success: true, data: [], pagination: { total: 0, page: 1, pageSize: 5 } } })
      }
      return Promise.reject(new Error(`unexpected url ${url}`))
    })

    renderWithProviders(<ManagerDashboard />)

    expect(await screen.findByText('No pending approvals')).toBeInTheDocument()
  })
})
