import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ExpenseTable from '@/components/expenses/ExpenseTable'
import { Status, Category } from '@/types'
import type { Expense } from '@/types'

function mockExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 7,
    submitted_by: 1,
    title: 'Hotel Stay',
    description: null,
    amount: 320.0,
    currency: 'USD',
    category: Category.TRAVEL,
    expense_date: '2024-04-10T00:00:00Z',
    status: Status.PENDING,
    approved_by: null,
    rejection_reason: null,
    version: 1,
    created_at: '2024-04-10T10:00:00Z',
    updated_at: '2024-04-10T10:00:00Z',
    ...overrides,
  }
}

function renderTable(expenses: Expense[], showSubmitter = false) {
  return render(
    <MemoryRouter>
      <ExpenseTable
        expenses={expenses}
        tableTestId="expense-table"
        rowTestId={(id) => `expense-row-${id}`}
        statusTestId={(id) => `expense-row-status-${id}`}
        showSubmitter={showSubmitter}
      />
    </MemoryRouter>
  )
}

describe('ExpenseTable', () => {
  it('renders the table with the given testid', () => {
    renderTable([mockExpense()])
    expect(screen.getByTestId('expense-table')).toBeInTheDocument()
  })

  it('renders a link with the expense title pointing to /expenses/:id', () => {
    renderTable([mockExpense({ id: 7, title: 'Hotel Stay' })])
    const link = screen.getByRole('link', { name: 'Hotel Stay' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/expenses/7')
  })

  it('renders the status badge with the correct text', () => {
    renderTable([mockExpense({ id: 7, status: Status.APPROVED })])
    const badge = screen.getByTestId('expense-row-status-7')
    expect(badge).toHaveTextContent('APPROVED')
  })

  it('renders a row with the given testid', () => {
    renderTable([mockExpense({ id: 42 })])
    expect(screen.getByTestId('expense-row-42')).toBeInTheDocument()
  })

  it('renders multiple rows', () => {
    renderTable([
      mockExpense({ id: 1, title: 'Lunch' }),
      mockExpense({ id: 2, title: 'Taxi' }),
    ])
    expect(screen.getByRole('link', { name: 'Lunch' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Taxi' })).toBeInTheDocument()
  })

  it('does not show Submitter column when showSubmitter is false', () => {
    renderTable([mockExpense({ submitter_name: 'Alice' })], false)
    expect(screen.queryByText('Submitter')).not.toBeInTheDocument()
  })

  it('shows Submitter column when showSubmitter is true', () => {
    renderTable([mockExpense({ submitter_name: 'Alice' })], true)
    expect(screen.getByText('Submitter')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renders em-dash when submitter_name is absent and showSubmitter is true', () => {
    renderTable([mockExpense({ submitter_name: undefined })], true)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
