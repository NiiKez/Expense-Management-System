import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'

// The axios instance and the MSAL auth module both reach out to the
// network / env at import time, so they're mocked before importing the
// component-under-test (transitively imports `@/services/api`).
jest.mock('@/services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    post: jest.fn().mockResolvedValue({ data: { success: true, data: { id: 1 } } }),
    put: jest.fn().mockResolvedValue({ data: { success: true, data: { id: 1 } } }),
  },
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
// Toast is fire-and-forget UI feedback; mock it so error-path assertions can read
// the exact message the form surfaced.
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
// Navigation is asserted via a mocked useNavigate; the rest of react-router-dom
// (MemoryRouter used by renderWithProviders) stays real.
const mockNavigate = jest.fn()
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}))

import api from '@/services/api'
import { toast } from 'sonner'
import ExpenseForm from '@/components/expenses/ExpenseForm'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { Category, Status } from '@/types'
import type { Expense } from '@/types'

// jest-axe's custom matcher (used by the a11y smoke test at the bottom).
expect.extend(toHaveNoViolations)

const mockedGet = api.get as jest.Mock
const mockedPost = api.post as jest.Mock
const mockedPut = api.put as jest.Mock

// A canonical stored expense used by the edit/resubmit/error suites. The date is a
// recent past day (within the 5-year floor, not in the future) so the schema passes.
const baseExpense: Expense = {
  id: 1,
  submitted_by: 1,
  title: 'Old title',
  description: null,
  amount: 50,
  currency: 'USD',
  category: Category.OTHER,
  expense_date: '2026-06-01T00:00:00Z',
  status: Status.PENDING,
  approved_by: null,
  rejection_reason: null,
  version: 1,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

// A receipt File the create-mode form appends to its multipart body. A PDF avoids
// the image-thumbnail path (FileDropzone only calls URL.createObjectURL on images,
// which jsdom doesn't implement).
function makeReceiptFile(name = 'receipt.pdf', type = 'application/pdf'): File {
  return new File(['receipt-bytes'], name, { type })
}

// Drop a file onto the hidden native input. fireEvent.change bypasses the input's
// `accept` filter so the component's own validate() runs (see FileDropzone tests).
function attachReceipt(file: File) {
  const input = document.getElementById('receipt-input') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

function ymd(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function renderForm() {
  return renderWithProviders(<ExpenseForm mode="create" />)
}

function fillValidBase() {
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Team lunch' } })
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '42.50' } })
  fireEvent.change(document.getElementById('expense_date')!, { target: { value: ymd(-1) } })
}

describe('ExpenseForm validation (mirrors server rules)', () => {
  beforeEach(() => mockedPost.mockClear())

  it('rejects a future expense date with the server-matching message', async () => {
    renderForm()
    fillValidBase()
    fireEvent.change(document.getElementById('expense_date')!, { target: { value: ymd(7) } })

    fireEvent.click(screen.getByTestId('expense-submit'))

    expect(await screen.findByText('Expense date cannot be in the future')).toBeInTheDocument()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('rejects an amount with more than two decimal places', async () => {
    renderForm()
    fillValidBase()
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '10.999' } })

    fireEvent.click(screen.getByTestId('expense-submit'))

    expect(await screen.findByText('Amount must have at most 2 decimal places')).toBeInTheDocument()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('submits a valid expense (recent past date, 2-decimal amount)', async () => {
    renderForm()
    fillValidBase()

    fireEvent.click(screen.getByTestId('expense-submit'))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/expenses', expect.any(FormData)))
  })
})

describe('ExpenseForm edit mode (changed-fields diff)', () => {
  beforeEach(() => mockedPut.mockClear())

  const initial: Expense = {
    id: 1,
    submitted_by: 1,
    title: 'Old title',
    description: null,
    amount: 50,
    currency: 'USD',
    category: Category.OTHER,
    expense_date: '2026-06-01T00:00:00Z',
    status: Status.PENDING,
    approved_by: null,
    rejection_reason: null,
    version: 1,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  }

  it('sends only the fields that actually changed', async () => {
    renderWithProviders(<ExpenseForm mode="edit" initial={initial} expenseId={1} />)
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New title' } })

    fireEvent.click(screen.getByTestId('expense-submit'))

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith('/expenses/1', { title: 'New title' }),
    )
  })

  it('does not re-send amount when the API delivered it as a DECIMAL string and it was not edited', async () => {
    // The wire shape for amount is a DECIMAL string ("50.00"), not a number. A
    // strict `!==` against the coerced numeric form value would always differ and
    // re-send amount on every edit; the diff must compare numerically.
    const wireInitial = { ...initial, amount: '50.00' as unknown as number }
    renderWithProviders(<ExpenseForm mode="edit" initial={wireInitial} expenseId={1} />)
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New title' } })

    fireEvent.click(screen.getByTestId('expense-submit'))

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith('/expenses/1', { title: 'New title' }),
    )
  })

  it('submits null (not an empty string) when a populated description is cleared', async () => {
    renderWithProviders(
      <ExpenseForm mode="edit" initial={{ ...initial, description: 'Some notes' }} expenseId={1} />,
    )
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })

    fireEvent.click(screen.getByTestId('expense-submit'))

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith('/expenses/1', { description: null }),
    )
  })

  it('navigates back without issuing a PUT when nothing changed (no-op edit)', async () => {
    mockedPut.mockClear()
    mockNavigate.mockClear()
    // Render on an unchanged pending expense and submit immediately: the diff is
    // empty, so the form must skip the (server-rejected) empty-body PUT and just
    // route back to the detail page.
    renderWithProviders(<ExpenseForm mode="edit" initial={baseExpense} expenseId={1} />)

    fireEvent.click(screen.getByTestId('expense-submit'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/expenses/1'))
    expect(mockedPut).not.toHaveBeenCalled()
  })
})

describe('ExpenseForm create mode (multipart body)', () => {
  beforeEach(() => {
    mockedPost.mockClear()
    mockNavigate.mockClear()
    // create mode fetches /me for the default currency; resolve it empty so the
    // currency stays at the USD fallback for this body assertion.
    mockedGet.mockResolvedValue({ data: { success: true, data: {} } })
  })

  it('posts a multipart body carrying every field and the attached receipt', async () => {
    renderForm()
    fillValidBase()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Client dinner' } })
    attachReceipt(makeReceiptFile('receipt.pdf'))

    fireEvent.click(screen.getByTestId('expense-submit'))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/expenses', expect.any(FormData)),
    )
    // Read the FormData back so a dropped/renamed field is caught (the old test
    // only checked it was *a* FormData).
    const fd = mockedPost.mock.calls[0][1] as FormData
    expect(fd.get('title')).toBe('Team lunch')
    // The coerced number is stringified, so the trailing zero of "42.50" drops.
    expect(fd.get('amount')).toBe('42.5')
    expect(fd.get('currency')).toBe('USD')
    expect(fd.get('category')).toBe(Category.OTHER)
    expect(fd.get('expense_date')).toBe(ymd(-1))
    expect(fd.get('description')).toBe('Client dinner')
    const receipt = fd.get('receipt') as File
    expect(receipt).toBeInstanceOf(File)
    expect(receipt.name).toBe('receipt.pdf')
    expect(receipt.type).toBe('application/pdf')
  })
})

describe('ExpenseForm currency default from profile', () => {
  beforeEach(() => {
    mockedGet.mockReset()
    mockNavigate.mockClear()
  })

  it('prefills the currency from the saved profile default while still at USD', async () => {
    // useMe (create mode only) resolves the profile; its default_currency wins over
    // the USD fallback because the user has not picked a currency yet.
    mockedGet.mockResolvedValue({ data: { success: true, data: { default_currency: 'EUR' } } })

    renderForm()

    // The currency Select trigger reflects the prefilled value once /me resolves.
    await waitFor(() => expect(document.getElementById('currency')).toHaveTextContent('EUR'))
  })
})

describe('ExpenseForm resubmit (rejected → pending)', () => {
  const rejected: Expense = { ...baseExpense, status: Status.REJECTED }

  beforeEach(() => {
    mockedPost.mockClear()
    mockNavigate.mockClear()
  })

  it('POSTs the full body to the resubmit endpoint for a rejected expense', async () => {
    // Editing a REJECTED expense re-files it for approval via /resubmit (not PUT).
    // The server accepts an unchanged body here, so the whole field set is sent.
    renderWithProviders(<ExpenseForm mode="edit" initial={rejected} expenseId={1} />)

    fireEvent.click(screen.getByTestId('expense-submit'))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/expenses/1/resubmit', {
        title: 'Old title',
        amount: 50,
        currency: 'USD',
        category: Category.OTHER,
        expense_date: '2026-06-01',
        description: null,
      }),
    )
    // A rejected expense edit must never hit the plain in-place update endpoint.
    expect(mockedPut).not.toHaveBeenCalled()
  })
})

describe('ExpenseForm submit-error handling', () => {
  beforeEach(() => {
    mockedPut.mockReset()
    mockNavigate.mockClear()
    ;(toast.error as jest.Mock).mockClear()
  })

  it('shows the reload toast on a 409 version conflict and surfaces no inline error', async () => {
    mockedPut.mockRejectedValueOnce({
      response: { status: 409, data: { error: { message: 'Version conflict' } } },
    })
    renderWithProviders(<ExpenseForm mode="edit" initial={baseExpense} expenseId={1} />)
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Changed title' } })

    fireEvent.click(screen.getByTestId('expense-submit'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This expense changed since you opened it — please reload.',
      ),
    )
    // The 409 branch returns early — it does not populate the inline error region.
    expect(screen.queryByTestId('expense-form-error')).not.toBeInTheDocument()
  })

  it('surfaces the server validation message in the inline error region on a 400', async () => {
    mockedPut.mockRejectedValueOnce({
      response: { status: 400, data: { error: { message: 'Amount exceeds the monthly policy limit.' } } },
    })
    renderWithProviders(<ExpenseForm mode="edit" initial={baseExpense} expenseId={1} />)
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Changed title' } })

    fireEvent.click(screen.getByTestId('expense-submit'))

    const errorBox = await screen.findByTestId('expense-form-error')
    expect(errorBox).toHaveTextContent('Amount exceeds the monthly policy limit.')
    // The same server reason is echoed to the toast.
    expect(toast.error).toHaveBeenCalledWith('Amount exceeds the monthly policy limit.')
  })
})

describe('ExpenseForm accessibility', () => {
  it('has no axe violations in create mode', async () => {
    mockedGet.mockResolvedValue({ data: { success: true, data: {} } })
    const { container } = renderForm()
    // The /me query resolves with no default_currency, so currency stays USD and
    // nothing visibly changes — waiting on the DOM would pass before the query
    // settles, letting its state update fire outside act() during axe's async gap.
    // Wait for the request, then flush the resulting update INSIDE act() before auditing.
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/me'))
    await act(async () => { await Promise.resolve() })
    expect(await axe(container)).toHaveNoViolations()
  })
})
