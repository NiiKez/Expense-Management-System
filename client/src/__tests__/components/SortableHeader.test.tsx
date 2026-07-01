import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SortableHeader from '@/components/common/SortableHeader'
import { Table, TableHeader, TableRow } from '@/components/ui/table'
import type { SortState } from '@/lib/sort'

// SortableHeader is a <th>; render it inside a valid table so the DOM is
// well-formed (mirrors the a11y test's harness).
function renderHeader(sort: SortState, onSort = jest.fn()) {
  render(
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader label="Amount" sortKey="amount" sort={sort} onSort={onSort} />
        </TableRow>
      </TableHeader>
    </Table>,
  )
  return onSort
}

describe('SortableHeader', () => {
  it('calls onSort with its sortKey when clicked', async () => {
    const user = userEvent.setup()
    const onSort = renderHeader({ key: null, order: 'desc' })

    await user.click(screen.getByTestId('sort-amount'))
    expect(onSort).toHaveBeenCalledTimes(1)
    expect(onSort).toHaveBeenCalledWith('amount')
  })

  it('marks an inactive column aria-sort="none" and shows the neutral icon', () => {
    renderHeader({ key: 'date', order: 'asc' })

    // The <th> carries aria-sort; inactive → none, and the accessible name omits
    // the direction.
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('button', { name: 'Sort by Amount' })).toBeInTheDocument()
    expect(document.querySelector('svg.lucide-chevrons-up-down')).toBeInTheDocument()
  })

  it('reflects the active column ascending: aria-sort + up arrow + labelled direction', () => {
    renderHeader({ key: 'amount', order: 'asc' })

    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
    expect(
      screen.getByRole('button', { name: 'Sort by Amount, currently ascending' }),
    ).toBeInTheDocument()
    expect(document.querySelector('svg.lucide-arrow-up')).toBeInTheDocument()
  })

  it('reflects the active column descending: aria-sort + down arrow + labelled direction', () => {
    renderHeader({ key: 'amount', order: 'desc' })

    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending')
    expect(
      screen.getByRole('button', { name: 'Sort by Amount, currently descending' }),
    ).toBeInTheDocument()
    expect(document.querySelector('svg.lucide-arrow-down')).toBeInTheDocument()
  })
})
