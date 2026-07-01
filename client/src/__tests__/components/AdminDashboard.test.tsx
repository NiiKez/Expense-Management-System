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
import AdminDashboard from '@/components/dashboard/AdminDashboard'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockExpense } from '../helpers/factories'
import type { AdminStats } from '@/types'

const mockedGet = api.get as jest.Mock

const stats: AdminStats = {
  orgSpendMonth: 50000,
  pendingOrgWide: 14,
  activeUsers: 37,
  approvedMonth: 41000,
  baseCurrency: 'USD',
  byCategory: [],
  monthly: [],
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedGet.mockImplementation((url: string) => {
    if (url === '/admin/stats') {
      return Promise.resolve({ data: { success: true, data: stats } })
    }
    if (url === '/admin/expenses') {
      return Promise.resolve({
        data: {
          success: true,
          data: [
            mockExpense({ id: 31, title: 'Office Supplies', submitter_name: 'Dave' }),
            mockExpense({ id: 32, title: 'Software License', submitter_name: 'Eve' }),
          ],
          pagination: { total: 2, page: 1, pageSize: 5 },
        },
      })
    }
    return Promise.reject(new Error(`unexpected url ${url}`))
  })
})

describe('AdminDashboard', () => {
  it('renders key stat values and recent activity rows from the hooks', async () => {
    renderWithProviders(<AdminDashboard />)

    // Key stat values (non-currency, locale-stable).
    expect(await screen.findByText('14')).toBeInTheDocument() // Pending org-wide
    expect(screen.getByText('37')).toBeInTheDocument() // Active users
    expect(screen.getByText('Pending org-wide')).toBeInTheDocument()
    expect(screen.getByText('Active users')).toBeInTheDocument()

    // A couple of recent activity rows render via ExpenseTable.
    await waitFor(() => {
      expect(screen.getByTestId('admin-recent-row-31')).toBeInTheDocument()
    })
    expect(screen.getByText('Office Supplies')).toBeInTheDocument()
    expect(screen.getByText('Software License')).toBeInTheDocument()
  })

  it('renders skeleton placeholders while the queries are pending', () => {
    mockedGet.mockReset()
    mockedGet.mockReturnValue(new Promise(() => {})) // never resolves → stays pending

    const { container } = renderWithProviders(<AdminDashboard />)

    // The stat + list skeletons render; the resolved happy content does not yet.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Active users')).not.toBeInTheDocument()
  })

  it('shows the "Could not load stats" empty state when the stats query errors', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/admin/stats') return Promise.reject(new Error('boom'))
      // Keep the list happy so we isolate the stats failure.
      return Promise.resolve({ data: { success: true, data: [], pagination: { total: 0, page: 1, pageSize: 5 } } })
    })

    renderWithProviders(<AdminDashboard />)

    expect(await screen.findByText('Could not load stats')).toBeInTheDocument()
  })

  it('shows the list error empty state when the recent-expenses query errors', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/admin/stats') return Promise.resolve({ data: { success: true, data: stats } })
      if (url === '/admin/expenses') return Promise.reject(new Error('boom'))
      return Promise.reject(new Error(`unexpected url ${url}`))
    })

    renderWithProviders(<AdminDashboard />)

    expect(await screen.findByText('Could not load recent expenses')).toBeInTheDocument()
  })

  it('shows the empty-list state when there are no recent expenses', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/admin/stats') return Promise.resolve({ data: { success: true, data: stats } })
      if (url === '/admin/expenses') {
        return Promise.resolve({ data: { success: true, data: [], pagination: { total: 0, page: 1, pageSize: 5 } } })
      }
      return Promise.reject(new Error(`unexpected url ${url}`))
    })

    renderWithProviders(<AdminDashboard />)

    expect(await screen.findByText('No recent expenses')).toBeInTheDocument()
  })
})
