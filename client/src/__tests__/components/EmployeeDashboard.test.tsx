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
})
