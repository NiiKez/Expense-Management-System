import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Status, Category } from '@/types'
import { useAdminExpenses, type AdminExpenseParams } from '@/queries/admin'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import StatusBadge from '@/components/expenses/StatusBadge'
import SortableHeader from '@/components/common/SortableHeader'
import { nextSort, type SortState } from '@/lib/sort'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import EmptyState from '@/components/common/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatCategory, formatDateShort } from '@/lib/format'
import { downloadFile } from '@/lib/download'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Download, Receipt, Search } from 'lucide-react'

// Native <select> styled to match the ui Select trigger. Kept native because the
// admin e2e suite drives status/category via Playwright's selectOption(), which
// only works on real <select> elements (Radix Select renders a <button>).
const SELECT_CLASS = cn(
  'h-9 appearance-none rounded-md border border-input bg-muted/40 bg-[length:0.75rem] bg-[right_0.6rem_center] bg-no-repeat py-1 pl-3 pr-8 text-sm shadow-xs',
  'transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50',
  "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')]",
)

interface Filters {
  search: string
  status: string
  category: string
  dateFrom: string
  dateTo: string
}

const INITIAL_FILTERS: Filters = {
  search: '',
  status: '',
  category: '',
  dateFrom: '',
  dateTo: '',
}

const PAGE_SIZE = 20

export default function AdminExpenses() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [sort, setSort] = useState<SortState>({ key: null, order: 'desc' })
  const [exporting, setExporting] = useState(false)
  // Debounce the free-text search so typing fires one request per pause. The
  // other filters (selects/date pickers) are committed immediately. The query
  // params below intentionally read `debouncedSearch`, not `filters.search`.
  const debouncedSearch = useDebouncedValue(filters.search, 300)

  const params: AdminExpenseParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    ...(sort.key ? { sort: sort.key, order: sort.order } : {}),
  }

  const { data, isPending, isError, refetch } = useAdminExpenses(params)
  const expenses = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleSort = (key: string) => {
    setSort((prev) => nextSort(prev, key))
    setPage(1)
  }

  const handleFilterChange = (field: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }))
    setPage(1)
  }

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS)
    setPage(1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params: Record<string, string> = {}
      if (filters.search) params.search = filters.search
      if (filters.status) params.status = filters.status
      if (filters.category) params.category = filters.category
      if (filters.dateFrom) params.date_from = filters.dateFrom
      if (filters.dateTo) params.date_to = filters.dateTo
      if (sort.key) {
        params.sort = sort.key
        params.order = sort.order
      }
      await downloadFile('/admin/expenses/export', params, 'expenses.csv')
    } catch {
      toast.error('Failed to export expenses.')
    } finally {
      setExporting(false)
    }
  }

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-4">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            data-testid="admin-filter-search"
            placeholder="Search by title…"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            aria-label="Search expenses"
            className="pl-9"
          />
        </div>

        <select
          data-testid="admin-filter-status"
          value={filters.status}
          onChange={(e) => handleFilterChange('status', e.target.value)}
          aria-label="Filter by status"
          className={cn(SELECT_CLASS, 'w-[150px]')}
        >
          <option value="">All statuses</option>
          {Object.values(Status).map((s) => (
            <option key={s} value={s}>{formatCategory(s)}</option>
          ))}
        </select>

        <select
          data-testid="admin-filter-category"
          value={filters.category}
          onChange={(e) => handleFilterChange('category', e.target.value)}
          aria-label="Filter by category"
          className={cn(SELECT_CLASS, 'w-[160px]')}
        >
          <option value="">All categories</option>
          {Object.values(Category).map((c) => (
            <option key={c} value={c}>{formatCategory(c)}</option>
          ))}
        </select>

        <Input
          type="date"
          data-testid="admin-filter-date-from"
          value={filters.dateFrom}
          onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
          aria-label="From date"
          title="From date"
          className="w-[150px]"
        />
        <Input
          type="date"
          data-testid="admin-filter-date-to"
          value={filters.dateTo}
          onChange={(e) => handleFilterChange('dateTo', e.target.value)}
          aria-label="To date"
          title="To date"
          className="w-[150px]"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="admin-filter-clear"
          onClick={clearFilters}
          disabled={!hasFilters}
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="export-csv"
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto"
        >
          <Download className="size-4" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </div>

      {/* Count */}
      {total > 0 && !isPending && (
        <p className="text-sm text-muted-foreground">{total} expense{total !== 1 ? 's' : ''}</p>
      )}

      {/* Table */}
      {isPending ? (
        <div className="space-y-2 rounded-lg border p-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={<Receipt className="size-6" />}
          title="Couldn’t load expenses"
          description="Failed to load expenses."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : expenses.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-6" />}
          title="No expenses found"
          description="No expenses match the current filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table data-testid="admin-expense-table">
            <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur supports-[backdrop-filter]:bg-muted/40">
              <TableRow>
                <SortableHeader label="Title" sortKey="title" sort={sort} onSort={handleSort} />
                <SortableHeader label="Submitter" sortKey="submitter" sort={sort} onSort={handleSort} />
                <SortableHeader label="Category" sortKey="category" sort={sort} onSort={handleSort} />
                <SortableHeader label="Amount" sortKey="amount" sort={sort} onSort={handleSort} align="right" className="text-right" />
                <SortableHeader label="Date" sortKey="date" sort={sort} onSort={handleSort} />
                <SortableHeader label="Status" sortKey="status" sort={sort} onSort={handleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e) => (
                <TableRow
                  key={e.id}
                  data-testid={`admin-expense-row-${e.id}`}
                  className="cursor-pointer"
                  onClick={() => navigate(`/expenses/${e.id}`)}
                >
                  <TableCell className="font-medium">
                    <Link
                      to={`/expenses/${e.id}`}
                      onClick={(ev) => ev.stopPropagation()}
                      className="hover:underline"
                    >
                      {e.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.submitter_name ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatCategory(e.category)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(Number(e.amount), e.currency)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateShort(e.expense_date)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={e.status}
                      data-testid={`admin-expense-status-${e.id}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && !isPending && !isError && (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="admin-pagination-prev"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="admin-pagination-next"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
