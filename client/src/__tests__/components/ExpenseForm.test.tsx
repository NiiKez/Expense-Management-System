import { screen, fireEvent, waitFor } from '@testing-library/react'

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

import api from '@/services/api'
import ExpenseForm from '@/components/expenses/ExpenseForm'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { Category, Status } from '@/types'
import type { Expense } from '@/types'

const mockedPost = api.post as jest.Mock
const mockedPut = api.put as jest.Mock

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
})
