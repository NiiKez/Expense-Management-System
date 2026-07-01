import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Radix UI's Select relies on pointer-capture + scrollIntoView APIs that jsdom
// does not implement; without these stubs the dropdown never opens. Scoped to
// this file so we don't touch shared test setup.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

// Mock the axios instance (default export) and the download helper, which both
// reach out to the network / env at import time. `@/services/auth` is mocked
// because `@/services/api` imports it (msal) at module load.
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
// The export-failure path surfaces a sonner toast; mock it so we can assert the
// call without rendering the real toaster.
jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn(), message: jest.fn() },
}))

import api from '@/services/api'
import { downloadFile } from '@/lib/download'
import { toast } from 'sonner'
import MyExpenses from '@/pages/MyExpenses'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockExpense, mockPaginatedResponse } from '../helpers/factories'

const mockedGet = api.get as jest.Mock
const mockedDownload = downloadFile as jest.Mock

function paramsOf(call: unknown[]): Record<string, unknown> | undefined {
  const cfg = call[1] as { params?: Record<string, unknown> } | undefined
  return cfg?.params
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedDownload.mockReset()
  ;(toast.error as jest.Mock).mockClear()
  mockedGet.mockResolvedValue({
    data: mockPaginatedResponse([mockExpense({ id: 1, title: 'Lunch' })]),
  })
})

describe('MyExpenses', () => {
  it('GETs /expenses with page+pageSize on initial load and renders the rows', async () => {
    renderWithProviders(<MyExpenses />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    expect(mockedGet).toHaveBeenCalledWith('/expenses', {
      params: { page: 1, pageSize: 20 },
    })

    expect(await screen.findByText('Lunch')).toBeInTheDocument()
  })

  it('shows the empty state when no expenses come back', async () => {
    mockedGet.mockResolvedValue({ data: mockPaginatedResponse([]) })
    renderWithProviders(<MyExpenses />)

    expect(await screen.findByText('No expenses found')).toBeInTheDocument()
  })

  it('shows an error state with a Try again button that refetches', async () => {
    mockedGet.mockRejectedValueOnce(new Error('boom'))
    renderWithProviders(<MyExpenses />)

    const retry = await screen.findByRole('button', { name: 'Try again' })

    // From here the request will succeed; clicking Try again must refetch.
    mockedGet.mockResolvedValue({
      data: mockPaginatedResponse([mockExpense({ id: 9, title: 'Recovered' })]),
    })
    await userEvent.click(retry)

    expect(await screen.findByText('Recovered')).toBeInTheDocument()
  })
})

describe('MyExpenses search', () => {
  it('debounces typing into a single request carrying the full term', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MyExpenses />)

    // Initial load fires (with no search term).
    await waitFor(() => expect(mockedGet).toHaveBeenCalled())

    const input = await screen.findByLabelText('Search expenses')
    await user.type(input, 'abc')

    // After the debounce settles, exactly one request carries the full 'abc'.
    await waitFor(() => {
      const full = mockedGet.mock.calls.filter((c) => paramsOf(c)?.search === 'abc')
      expect(full).toHaveLength(1)
    })

    // Crucially, no per-keystroke 'a' / 'ab' requests leaked through.
    const partials = mockedGet.mock.calls.filter(
      (c) => paramsOf(c)?.search === 'a' || paramsOf(c)?.search === 'ab',
    )
    expect(partials).toHaveLength(0)
  })

  it('resets to page 1 when the search term changes', async () => {
    const user = userEvent.setup()
    // Enough rows to enable pagination so we can advance to page 2.
    mockedGet.mockResolvedValue({
      data: mockPaginatedResponse(
        [mockExpense({ id: 1, title: 'Lunch' })],
        { total: 60, page: 1, pageSize: 20 },
      ),
    })
    renderWithProviders(<MyExpenses />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())

    await user.click(await screen.findByRole('button', { name: /Next/ }))
    await waitFor(() => {
      expect(mockedGet.mock.calls.some((c) => paramsOf(c)?.page === 2)).toBe(true)
    })

    await user.type(await screen.findByLabelText('Search expenses'), 'taxi')

    // The search request must reset back to page 1.
    await waitFor(() => {
      const searchCall = mockedGet.mock.calls.find((c) => paramsOf(c)?.search === 'taxi')
      expect(searchCall).toBeDefined()
      expect(paramsOf(searchCall as unknown[])?.page).toBe(1)
    })
  })
})

describe('MyExpenses filters', () => {
  it('refetches with the new status param when the status filter changes', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MyExpenses />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())

    await user.click(screen.getByLabelText('Filter by status'))
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByText('Approved'))

    await waitFor(() => {
      const call = mockedGet.mock.calls.find((c) => paramsOf(c)?.status === 'APPROVED')
      expect(call).toBeDefined()
      expect(paramsOf(call as unknown[])?.page).toBe(1)
    })
  })

  it('refetches with the new category param when the category filter changes', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MyExpenses />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())

    await user.click(screen.getByLabelText('Filter by category'))
    const listbox = await screen.findByRole('listbox')
    // Option labels are Title-cased (formatCategory) — 'TRAVEL' → 'Travel'.
    await user.click(within(listbox).getByText('Travel'))

    await waitFor(() => {
      const call = mockedGet.mock.calls.find((c) => paramsOf(c)?.category === 'TRAVEL')
      expect(call).toBeDefined()
      expect(paramsOf(call as unknown[])?.page).toBe(1)
    })
  })
})

describe('MyExpenses sorting', () => {
  it('sends sort+order params and toggles the order when a header is re-clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MyExpenses />)

    // The sortable table only renders once rows are present.
    await screen.findByText('Lunch')

    // First click on a fresh column starts descending (see nextSort).
    await user.click(screen.getByTestId('sort-amount'))
    await waitFor(() => {
      const call = mockedGet.mock.calls.find(
        (c) => paramsOf(c)?.sort === 'amount' && paramsOf(c)?.order === 'desc',
      )
      expect(call).toBeDefined()
      // Sorting resets to page 1.
      expect(paramsOf(call as unknown[])?.page).toBe(1)
    })

    // Re-clicking the active column flips to ascending.
    await user.click(screen.getByTestId('sort-amount'))
    await waitFor(() => {
      expect(
        mockedGet.mock.calls.some(
          (c) => paramsOf(c)?.sort === 'amount' && paramsOf(c)?.order === 'asc',
        ),
      ).toBe(true)
    })
  })
})

describe('MyExpenses pagination', () => {
  it('disables Previous on page 1 and enables it after advancing a page', async () => {
    const user = userEvent.setup()
    // Enough rows to span multiple pages so the pagination controls render.
    mockedGet.mockResolvedValue({
      data: mockPaginatedResponse(
        [mockExpense({ id: 1, title: 'Lunch' })],
        { total: 60, page: 1, pageSize: 20 },
      ),
    })
    renderWithProviders(<MyExpenses />)

    await screen.findByText('Lunch')

    const prev = screen.getByRole('button', { name: /Previous/ })
    expect(prev).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(prev).toBeEnabled())
  })
})

describe('MyExpenses export', () => {
  it('calls downloadFile for CSV export with the active filters', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MyExpenses />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())

    await user.type(await screen.findByLabelText('Search expenses'), 'hotel')

    // Export uses the debounced term so the file matches the on-screen table —
    // wait for the debounce to reach the list query before exporting.
    await waitFor(() =>
      expect(mockedGet.mock.calls.some((c) => paramsOf(c)?.search === 'hotel')).toBe(true),
    )
    await user.click(screen.getByTestId('export-csv'))

    await waitFor(() => expect(mockedDownload).toHaveBeenCalled())
    expect(mockedDownload).toHaveBeenCalledWith(
      '/expenses/export',
      expect.objectContaining({ search: 'hotel' }),
      'my-expenses.csv',
    )
  })

  it('surfaces an error toast when the export download fails', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MyExpenses />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())

    mockedDownload.mockRejectedValueOnce(new Error('network down'))
    await user.click(screen.getByTestId('export-csv'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to export expenses.'),
    )
  })
})
