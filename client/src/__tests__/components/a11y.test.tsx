import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe, toHaveNoViolations } from 'jest-axe'
import SortableHeader from '@/components/common/SortableHeader'
import FileDropzone from '@/components/expenses/FileDropzone'
import ExpenseTable from '@/components/expenses/ExpenseTable'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { Status, Category } from '@/types'
import type { Expense } from '@/types'
import type { SortState } from '@/lib/sort'

// Wire jest-axe's custom matcher so `toHaveNoViolations` is available below.
// Without this the suite only checked accessible names; now we run the real
// axe-core ruleset against the rendered DOM.
expect.extend(toHaveNoViolations)

function renderHeader(sort: SortState) {
  return render(
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader label="Title" sortKey="title" sort={sort} onSort={() => {}} />
        </TableRow>
      </TableHeader>
    </Table>,
  )
}

// A complete, well-formed table for axe. A bare <thead> without a <tbody> trips
// axe's table-structure heuristics, so we wrap the header in a full table with a
// data row — this exercises SortableHeader inside a valid table landmark.
function renderHeaderInFullTable(sort: SortState) {
  return render(
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader label="Title" sortKey="title" sort={sort} onSort={() => {}} />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Sample row</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  )
}

describe('SortableHeader accessibility', () => {
  it('describes the sort action when the column is inactive', () => {
    renderHeader({ key: null, order: 'desc' })
    expect(screen.getByRole('button', { name: 'Sort by Title' })).toBeInTheDocument()
  })

  it('announces the current sort direction when the column is active', () => {
    renderHeader({ key: 'title', order: 'asc' })
    expect(
      screen.getByRole('button', { name: 'Sort by Title, currently ascending' }),
    ).toBeInTheDocument()
  })

  it('has no axe violations when inactive', async () => {
    const { container } = renderHeaderInFullTable({ key: null, order: 'desc' })
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no axe violations when active (aria-sort set)', async () => {
    const { container } = renderHeaderInFullTable({ key: 'title', order: 'asc' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ExpenseTable accessibility', () => {
  function mockExpense(): Expense {
    return {
      id: 7,
      submitted_by: 1,
      title: 'Hotel Stay',
      description: null,
      amount: 320,
      currency: 'USD',
      category: Category.TRAVEL,
      expense_date: '2024-04-10T00:00:00Z',
      status: Status.PENDING,
      approved_by: null,
      rejection_reason: null,
      version: 1,
      created_at: '2024-04-10T10:00:00Z',
      updated_at: '2024-04-10T10:00:00Z',
    }
  }

  function renderTable() {
    return render(
      <MemoryRouter>
        <ExpenseTable
          expenses={[mockExpense()]}
          tableTestId="expense-table"
          rowTestId={(id) => `expense-row-${id}`}
          statusTestId={(id) => `expense-row-status-${id}`}
        />
      </MemoryRouter>,
    )
  }

  it('exposes navigation as a keyboard-focusable link rather than a mouse-only row handler', () => {
    renderTable()
    const link = screen.getByRole('link', { name: 'Hotel Stay' })
    expect(link).toHaveAttribute('href', '/expenses/7')
  })

  it('has no axe violations (rows are not nested-interactive controls)', async () => {
    const { container } = renderTable()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('FileDropzone accessibility', () => {
  // KNOWN FINDING (component not fixed here, tests-only change): the always-mounted
  // hidden native <input id="receipt-input" type="file"> has no label, so axe's
  // `label` rule flags it ("Form elements must have labels"). The visible dropzone
  // is a role="button" with a full aria-label, and the input is sr-only/click-proxied,
  // so the interaction is accessible — but the bare file input is still a real,
  // narrow gap. We disable ONLY the `label` rule for this component so every other
  // axe rule (aria, color-contrast structure, roles, etc.) is still enforced for
  // real, rather than fixing source from a tests-only task.
  const FILE_INPUT_LABEL_FINDING = { rules: { label: { enabled: false } } }

  it('gives the focusable dropzone an accessible name', () => {
    render(<FileDropzone onFile={() => {}} />)
    const dropzone = screen.getByRole('button', { name: /receipt/i })
    expect(dropzone).toHaveAttribute('tabindex', '0')
  })

  it('has no axe violations in the empty state (excluding the known unlabeled file input)', async () => {
    const { container } = render(<FileDropzone onFile={() => {}} />)
    expect(await axe(container, FILE_INPUT_LABEL_FINDING)).toHaveNoViolations()
  })

  it('has no axe violations when an error is shown (aria-invalid + alert)', async () => {
    const { container } = render(
      <FileDropzone onFile={() => {}} error="File size must be under 5 MB." />,
    )
    expect(await axe(container, FILE_INPUT_LABEL_FINDING)).toHaveNoViolations()
  })

  // Pin the known finding so it's documented and verified, not silently ignored:
  // with the default ruleset axe SHOULD still report the unlabeled file input.
  it('documents the known unlabeled file-input finding (default ruleset still reports it)', async () => {
    const { container } = render(<FileDropzone onFile={() => {}} />)
    const results = await axe(container)
    const labelViolation = results.violations.find((v) => v.id === 'label')
    expect(labelViolation).toBeDefined()
    expect(labelViolation?.nodes.some((n) => n.html.includes('receipt-input'))).toBe(true)
  })
})
