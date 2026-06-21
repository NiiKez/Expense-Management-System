import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockExpense, mockPaginatedResponse } from '../helpers/factories'

// AdminExpenses transitively imports @/services/api (via @/queries/admin) and
// @/lib/download. Mock both so nothing touches the network/env at import time.
jest.mock('@/services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}))
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
jest.mock('@/lib/download', () => ({ downloadFile: jest.fn() }))

import api from '@/services/api'
import AdminExpenses from '@/components/admin/AdminExpenses'

const mockedGet = api.get as jest.Mock

function paramsOf(call: unknown[]): Record<string, unknown> | undefined {
  const cfg = call[1] as { params?: Record<string, unknown> } | undefined
  return cfg?.params
}

describe('AdminExpenses', () => {
  beforeEach(() => {
    mockedGet.mockReset()
    mockedGet.mockResolvedValue({
      data: mockPaginatedResponse(
        [
          mockExpense({ id: 1, title: 'Team Lunch' }),
          mockExpense({ id: 2, title: 'Taxi Ride' }),
        ],
        { total: 2, page: 1, pageSize: 20 },
      ),
    })
  })

  it('announces the loading state to assistive tech', () => {
    mockedGet.mockReset()
    mockedGet.mockReturnValue(new Promise(() => {})) // never resolves → stays pending
    renderWithProviders(<AdminExpenses />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading expenses…')
  })

  it('renders the expense rows returned by the query', async () => {
    renderWithProviders(<AdminExpenses />)

    expect(await screen.findByText('Team Lunch')).toBeInTheDocument()
    expect(screen.getByText('Taxi Ride')).toBeInTheDocument()
    expect(screen.getByTestId('admin-expense-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('admin-expense-row-2')).toBeInTheDocument()

    // First request carries the base pagination params and no filters.
    const first = mockedGet.mock.calls[0]
    expect(first[0]).toBe('/admin/expenses')
    expect(paramsOf(first)).toMatchObject({ page: 1, pageSize: 20 })
  })

  it('requests new params when a filter changes (status)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminExpenses />)

    await screen.findByText('Team Lunch')

    await user.selectOptions(screen.getByTestId('admin-filter-status'), 'APPROVED')

    // A request carrying the chosen status reaches the API.
    await waitFor(() => {
      const withStatus = mockedGet.mock.calls.filter(
        (c) => paramsOf(c)?.status === 'APPROVED',
      )
      expect(withStatus.length).toBeGreaterThan(0)
    })
  })

  it('debounces search typing into a single request carrying the full term', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminExpenses />)

    await screen.findByText('Team Lunch')

    const input = screen.getByTestId('admin-filter-search')
    await user.type(input, 'abc')

    // Exactly one request carries the full 'abc' after the debounce settles.
    await waitFor(() => {
      const full = mockedGet.mock.calls.filter((c) => paramsOf(c)?.search === 'abc')
      expect(full).toHaveLength(1)
    })

    // No per-keystroke partial 'a'/'ab' requests leaked through.
    const partials = mockedGet.mock.calls.filter(
      (c) => paramsOf(c)?.search === 'a' || paramsOf(c)?.search === 'ab',
    )
    expect(partials).toHaveLength(0)
  })
})
