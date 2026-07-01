import React from 'react'
import { screen, waitFor } from '@testing-library/react'

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks. Stub a
// no-op so the charts mount (empty) instead of throwing.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub

// Mock the axios instance (default export) and msal so importing the component
// (→ @/services/api → @/services/auth) doesn't reach the network or Web Crypto.
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
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockExpense } from '../helpers/factories'
import type { MeStats } from '@/types'

const mockedGet = api.get as jest.Mock

const stats: MeStats = {
  totals: { submitted: 7, pending: 2, approved: 4, rejected: 1 },
  approvedAmountMonth: 1234,
  baseCurrency: 'USD',
  byCategory: [],
  monthly: [],
}

beforeEach(() => {
  mockedGet.mockReset()
  // Route by URL: /me/stats returns the stats envelope, /expenses returns a page.
  mockedGet.mockImplementation((url: string) => {
    if (url === '/me/stats') {
      return Promise.resolve({ data: { success: true, data: stats } })
    }
    if (url === '/expenses') {
      return Promise.resolve({
        data: {
          success: true,
          data: [
            mockExpense({ id: 11, title: 'Client Dinner' }),
            mockExpense({ id: 12, title: 'Taxi to Airport' }),
          ],
          pagination: { total: 2, page: 1, pageSize: 20 },
        },
      })
    }
    return Promise.reject(new Error(`unexpected url ${url}`))
  })
})

describe('EmployeeDashboard', () => {
  it('renders key stat values and recent expense rows from the hooks', async () => {
    renderWithProviders(<EmployeeDashboard />)

    // Key stat values (non-currency, locale-stable).
    expect(await screen.findByText('7')).toBeInTheDocument() // Total submitted
    expect(screen.getByText('2')).toBeInTheDocument() // Pending
    expect(screen.getByText('1')).toBeInTheDocument() // Rejected
    expect(screen.getByText('Total submitted')).toBeInTheDocument()

    // A couple of list rows render via ExpenseTable.
    await waitFor(() => {
      expect(screen.getByTestId('expense-row-11')).toBeInTheDocument()
    })
    expect(screen.getByText('Client Dinner')).toBeInTheDocument()
    expect(screen.getByText('Taxi to Airport')).toBeInTheDocument()
  })

  it('renders skeleton placeholders while the queries are pending', () => {
    mockedGet.mockReset()
    mockedGet.mockReturnValue(new Promise(() => {})) // never resolves → stays pending

    const { container } = renderWithProviders(<EmployeeDashboard />)

    // The stat + list skeletons render; the resolved happy content does not yet.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Total submitted')).not.toBeInTheDocument()
  })

  it('shows the "Could not load stats" empty state when the stats query errors', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/me/stats') return Promise.reject(new Error('boom'))
      // Keep the list happy so we isolate the stats failure.
      return Promise.resolve({ data: { success: true, data: [], pagination: { total: 0, page: 1, pageSize: 20 } } })
    })

    renderWithProviders(<EmployeeDashboard />)

    expect(await screen.findByText('Could not load stats')).toBeInTheDocument()
  })

  it('shows the list error empty state when the expenses query errors', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/me/stats') return Promise.resolve({ data: { success: true, data: stats } })
      if (url === '/expenses') return Promise.reject(new Error('boom'))
      return Promise.reject(new Error(`unexpected url ${url}`))
    })

    renderWithProviders(<EmployeeDashboard />)

    expect(await screen.findByText('Could not load expenses')).toBeInTheDocument()
  })

  it('shows the empty-list state when no expenses come back', async () => {
    mockedGet.mockReset()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/me/stats') return Promise.resolve({ data: { success: true, data: stats } })
      if (url === '/expenses') {
        return Promise.resolve({ data: { success: true, data: [], pagination: { total: 0, page: 1, pageSize: 20 } } })
      }
      return Promise.reject(new Error(`unexpected url ${url}`))
    })

    renderWithProviders(<EmployeeDashboard />)

    expect(await screen.findByText('No expenses yet')).toBeInTheDocument()
  })
})
