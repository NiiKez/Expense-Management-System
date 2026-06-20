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
})
