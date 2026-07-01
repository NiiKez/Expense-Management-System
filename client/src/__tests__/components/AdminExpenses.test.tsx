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
// Export failures surface as a toast; mock so no <Toaster> is required.
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

import api from '@/services/api'
import { downloadFile } from '@/lib/download'
import { toast } from 'sonner'
import AdminExpenses from '@/components/admin/AdminExpenses'

const mockedGet = api.get as jest.Mock
const mockedDownload = downloadFile as jest.Mock
const mockedToastError = toast.error as jest.Mock

function paramsOf(call: unknown[]): Record<string, unknown> | undefined {
  const cfg = call[1] as { params?: Record<string, unknown> } | undefined
  return cfg?.params
}

describe('AdminExpenses', () => {
  beforeEach(() => {
    mockedGet.mockReset()
    mockedDownload.mockReset()
    mockedToastError.mockReset()
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

  it('links each row to its detail page and renders the formatted amount', async () => {
    mockedGet.mockReset()
    mockedGet.mockResolvedValue({
      data: mockPaginatedResponse(
        [mockExpense({ id: 7, title: 'Hotel Stay', amount: 75.5, currency: 'USD' })],
        { total: 1, page: 1, pageSize: 20 },
      ),
    })
    renderWithProviders(<AdminExpenses />)

    const link = await screen.findByRole('link', { name: 'Hotel Stay' })
    expect(link).toHaveAttribute('href', '/expenses/7')
    // formatCurrency(75.5, 'USD') → "$75.50" (see lib/format.test.ts).
    expect(screen.getByText('$75.50')).toBeInTheDocument()
  })

  it('requests the chosen category filter', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminExpenses />)
    await screen.findByText('Team Lunch')

    await user.selectOptions(screen.getByTestId('admin-filter-category'), 'TRAVEL')

    await waitFor(() => {
      const withCategory = mockedGet.mock.calls.filter(
        (c) => paramsOf(c)?.category === 'TRAVEL',
      )
      expect(withCategory.length).toBeGreaterThan(0)
    })
  })

  it('requests the chosen date-from filter', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminExpenses />)
    await screen.findByText('Team Lunch')

    await user.type(screen.getByTestId('admin-filter-date-from'), '2024-01-01')

    await waitFor(() => {
      const withDate = mockedGet.mock.calls.filter(
        (c) => paramsOf(c)?.date_from === '2024-01-01',
      )
      expect(withDate.length).toBeGreaterThan(0)
    })
  })

  it('adds sort + order params (desc first) when a header is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminExpenses />)
    await screen.findByText('Team Lunch')

    await user.click(screen.getByTestId('sort-amount'))

    await waitFor(() => {
      const sorted = mockedGet.mock.calls.filter(
        (c) => paramsOf(c)?.sort === 'amount' && paramsOf(c)?.order === 'desc',
      )
      expect(sorted.length).toBeGreaterThan(0)
    })
  })

  it('clears every filter and resets the page to 1', async () => {
    const user = userEvent.setup()
    // Paginated so we can move off page 1 first.
    mockedGet.mockReset()
    mockedGet.mockResolvedValue({
      data: mockPaginatedResponse(
        [mockExpense({ id: 1, title: 'Team Lunch' })],
        { total: 45, page: 1, pageSize: 20 },
      ),
    })
    renderWithProviders(<AdminExpenses />)
    await screen.findByText('Team Lunch')

    // Apply a filter and advance the page.
    await user.selectOptions(screen.getByTestId('admin-filter-status'), 'APPROVED')
    await user.click(screen.getByTestId('admin-pagination-next'))
    await waitFor(() => {
      expect(mockedGet.mock.calls.some((c) => paramsOf(c)?.page === 2)).toBe(true)
    })

    await user.click(screen.getByTestId('admin-filter-clear'))

    // A subsequent request drops the status filter and is back on page 1.
    await waitFor(() => {
      const last = mockedGet.mock.calls.at(-1) as unknown[]
      expect(paramsOf(last)?.status).toBeUndefined()
      expect(paramsOf(last)?.page).toBe(1)
    })
    // The select is visually reset too.
    expect(screen.getByTestId('admin-filter-status')).toHaveValue('')
  })

  it('paginates: Next advances the page and Previous is disabled on page 1', async () => {
    const user = userEvent.setup()
    mockedGet.mockReset()
    mockedGet.mockResolvedValue({
      data: mockPaginatedResponse(
        [mockExpense({ id: 1, title: 'Team Lunch' })],
        { total: 45, page: 1, pageSize: 20 },
      ),
    })
    renderWithProviders(<AdminExpenses />)
    await screen.findByText('Team Lunch')

    expect(screen.getByTestId('admin-pagination-prev')).toBeDisabled()

    await user.click(screen.getByTestId('admin-pagination-next'))

    await waitFor(() => {
      expect(mockedGet.mock.calls.some((c) => paramsOf(c)?.page === 2)).toBe(true)
    })
    expect(screen.getByTestId('admin-pagination-prev')).toBeEnabled()
  })

  it('shows the error state with a Try again button that refetches', async () => {
    mockedGet.mockReset()
    mockedGet.mockRejectedValueOnce(new Error('boom'))
    renderWithProviders(<AdminExpenses />)

    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText('Couldn’t load expenses')).toBeInTheDocument()

    // From here the request succeeds; Try again must refetch and render rows.
    mockedGet.mockResolvedValue({
      data: mockPaginatedResponse([mockExpense({ id: 9, title: 'Recovered' })]),
    })
    await userEvent.click(retry)

    expect(await screen.findByText('Recovered')).toBeInTheDocument()
  })

  it('shows the empty state when no expenses match', async () => {
    mockedGet.mockReset()
    mockedGet.mockResolvedValue({ data: mockPaginatedResponse([]) })
    renderWithProviders(<AdminExpenses />)

    expect(await screen.findByText('No expenses found')).toBeInTheDocument()
  })

  it('exports CSV with the active filters via downloadFile', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminExpenses />)
    await screen.findByText('Team Lunch')

    await user.selectOptions(screen.getByTestId('admin-filter-status'), 'APPROVED')
    await user.click(screen.getByTestId('export-csv'))

    await waitFor(() => expect(mockedDownload).toHaveBeenCalled())
    expect(mockedDownload).toHaveBeenCalledWith(
      '/admin/expenses/export',
      expect.objectContaining({ status: 'APPROVED' }),
      'expenses.csv',
    )
  })

  it('toasts an error when the export download fails', async () => {
    const user = userEvent.setup()
    mockedDownload.mockRejectedValueOnce(new Error('network'))
    renderWithProviders(<AdminExpenses />)
    await screen.findByText('Team Lunch')

    await user.click(screen.getByTestId('export-csv'))

    await waitFor(() =>
      expect(mockedToastError).toHaveBeenCalledWith('Failed to export expenses.'),
    )
  })
})
