import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { UseQueryResult } from '@tanstack/react-query'

// Control the data hook directly so each load branch is deterministic, and stub
// ExpenseForm to a marker (it drags in RHF/zod/Select + its own queries) so the
// success case only proves the right form is mounted with the right props.
jest.mock('@/queries/expenses', () => ({ useExpense: jest.fn() }))
jest.mock('@/components/expenses/ExpenseForm', () => ({
  __esModule: true,
  default: (props: { mode: string; expenseId: number }) => (
    <div
      data-testid="expense-form"
      data-mode={props.mode}
      data-expense-id={String(props.expenseId)}
    />
  ),
}))

import { useExpense } from '@/queries/expenses'
import EditExpense from '@/pages/EditExpense'
import { mockExpense } from '../helpers/factories'
import type { ExpenseWithReceipts } from '@/queries/expenses'

const mockUseExpense = useExpense as jest.MockedFunction<typeof useExpense>
const refetch = jest.fn()

// Minimal UseQueryResult stand-in — EditExpense only reads data/isPending/isError/refetch.
function result(
  over: Partial<UseQueryResult<ExpenseWithReceipts, Error>>,
): UseQueryResult<ExpenseWithReceipts, Error> {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    refetch,
    ...over,
  } as UseQueryResult<ExpenseWithReceipts, Error>
}

function tree(id: string) {
  return (
    <MemoryRouter initialEntries={[`/expenses/${id}/edit`]}>
      <Routes>
        <Route path="/expenses/:id/edit" element={<EditExpense />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockUseExpense.mockReset()
  refetch.mockReset()
  mockUseExpense.mockReturnValue(result({ isPending: true }))
})

describe('EditExpense invalid reference', () => {
  it.each(['abc', '0', '-3', '1e3', '99999999999999999999'])(
    'shows the invalid-reference error and skips the fetch for id %s',
    (id) => {
      render(tree(id))

      expect(screen.getByText('Invalid expense reference.')).toBeInTheDocument()
      // A null id disables the query — the hook is called with null, so nothing fires.
      expect(mockUseExpense).toHaveBeenCalledWith(null)
      expect(screen.queryByTestId('expense-form')).not.toBeInTheDocument()
    },
  )
})

describe('EditExpense success', () => {
  it('loads a valid id and mounts ExpenseForm in edit mode', () => {
    mockUseExpense.mockReturnValue(result({ data: mockExpense({ id: 5 }) }))
    render(tree('5'))

    expect(mockUseExpense).toHaveBeenCalledWith(5)
    const form = screen.getByTestId('expense-form')
    expect(form).toHaveAttribute('data-mode', 'edit')
    expect(form).toHaveAttribute('data-expense-id', '5')
  })
})

describe('EditExpense error', () => {
  it('offers Try again which refetches and then recovers to the form', async () => {
    mockUseExpense.mockReturnValue(result({ isError: true }))
    const { rerender } = render(tree('5'))

    expect(screen.getByText('Failed to load expense. Please try again.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)

    // The refetch succeeds — re-render with success and the form appears.
    mockUseExpense.mockReturnValue(result({ data: mockExpense({ id: 5 }) }))
    rerender(tree('5'))
    expect(await screen.findByTestId('expense-form')).toBeInTheDocument()
  })
})

describe('EditExpense not found', () => {
  it('shows the not-found message (no retry) when the expense is missing', () => {
    mockUseExpense.mockReturnValue(result({ data: undefined, isError: false }))
    render(tree('5'))

    expect(screen.getByText('Expense not found.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
