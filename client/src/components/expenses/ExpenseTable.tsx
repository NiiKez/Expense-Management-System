import { Link, useNavigate } from 'react-router-dom'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import StatusBadge from '@/components/expenses/StatusBadge'
import SortableHeader from '@/components/common/SortableHeader'
import type { SortState } from '@/lib/sort'
import { formatCurrency, formatDateShort, formatCategory } from '@/lib/format'
import type { Expense } from '@/types'

interface ExpenseTableProps {
  expenses: Expense[]
  tableTestId: string
  rowTestId: (id: number) => string
  statusTestId: (id: number) => string
  showSubmitter?: boolean
  // When both are provided, column headers become interactive sort controls.
  sort?: SortState
  onSort?: (key: string) => void
}

export default function ExpenseTable({
  expenses,
  tableTestId,
  rowTestId,
  statusTestId,
  showSubmitter = false,
  sort,
  onSort,
}: ExpenseTableProps) {
  const navigate = useNavigate()
  const sortable = !!(sort && onSort)

  return (
    <div className="tabular overflow-hidden rounded-lg border bg-card shadow-sm">
      <Table data-testid={tableTestId}>
        <TableHeader>
          <TableRow>
            {sortable ? (
              <>
                <SortableHeader label="Title" sortKey="title" sort={sort!} onSort={onSort!} />
                {showSubmitter && (
                  <SortableHeader label="Submitter" sortKey="submitter" sort={sort!} onSort={onSort!} />
                )}
                <SortableHeader label="Category" sortKey="category" sort={sort!} onSort={onSort!} />
                <SortableHeader label="Amount" sortKey="amount" sort={sort!} onSort={onSort!} align="right" className="text-right tabular-nums" />
                <SortableHeader label="Date" sortKey="date" sort={sort!} onSort={onSort!} />
                <SortableHeader label="Status" sortKey="status" sort={sort!} onSort={onSort!} />
              </>
            ) : (
              <>
                <TableHead>Title</TableHead>
                {showSubmitter && <TableHead>Submitter</TableHead>}
                <TableHead>Category</TableHead>
                <TableHead className="text-right tabular-nums">Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {expenses.map((e) => (
            <TableRow
              key={e.id}
              data-testid={rowTestId(e.id)}
              className="cursor-pointer"
              onClick={() => navigate('/expenses/' + e.id)}
            >
              <TableCell>
                <Link
                  to={'/expenses/' + e.id}
                  onClick={(ev) => ev.stopPropagation()}
                  className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  {e.title}
                </Link>
              </TableCell>
              {showSubmitter && (
                <TableCell className="text-muted-foreground">
                  {e.submitter_name ?? '—'}
                </TableCell>
              )}
              <TableCell className="text-muted-foreground">
                {formatCategory(e.category)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCurrency(e.amount, e.currency)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateShort(e.expense_date)}
              </TableCell>
              <TableCell>
                <StatusBadge
                  status={e.status}
                  data-testid={statusTestId(e.id)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
