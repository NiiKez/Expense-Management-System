import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Inbox,
  AlertTriangle,
  Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { Category, Status } from '@/types'
import { formatCategory } from '@/lib/format'
import { downloadFile } from '@/lib/download'
import { useExpenses, type ExpenseListParams } from '@/queries/expenses'
import ExpenseTable from '@/components/expenses/ExpenseTable'
import { nextSort, type SortState } from '@/lib/sort'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useResetPageOnChange } from '@/lib/useResetPageOnChange'
import EmptyState from '@/components/common/EmptyState'
import PageHeader from '@/components/common/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const PAGE_SIZE = 20
const ALL = 'ALL'

const ALL_CATEGORIES = Object.values(Category)
const ALL_STATUSES = Object.values(Status)

export default function MyExpenses() {
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  // Debounced so search-as-you-type fires one request per pause, not per
  // keystroke. The visible input stays on `search`; the request reads this.
  const debouncedSearch = useDebouncedValue(search, 300)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [sort, setSort] = useState<SortState>({ key: null, order: 'desc' })
  const [exporting, setExporting] = useState(false)

  // Reset to page 1 whenever the debounced search changes (see the hook).
  const effectivePage = useResetPageOnChange(debouncedSearch, page, setPage)

  // Build the query params from the current filter/sort/page state. A change to
  // any of these changes the query key, so the hook refetches automatically.
  const params: ExpenseListParams = { page: effectivePage, pageSize: PAGE_SIZE }
  if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
  if (statusFilter) params.status = statusFilter
  if (categoryFilter) params.category = categoryFilter
  if (sort.key) {
    params.sort = sort.key
    params.order = sort.order
  }

  const { data, isPending, isError, refetch } = useExpenses(params)
  const expenses = data?.items ?? []
  const total = data?.total ?? 0

  const handleSort = (key: string) => {
    setSort((prev) => nextSort(prev, key))
    setPage(1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params: Record<string, string> = {}
      // Use the debounced term so the export matches what the table is showing.
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
      if (statusFilter) params.status = statusFilter
      if (categoryFilter) params.category = categoryFilter
      if (sort.key) {
        params.sort = sort.key
        params.order = sort.order
      }
      await downloadFile('/expenses/export', params, 'my-expenses.csv')
    } catch {
      toast.error('Failed to export expenses.')
    } finally {
      setExporting(false)
    }
  }

  const handleSearch = (value: string) => {
    setSearch(value)
  }
  const handleStatus = (value: string) => {
    setStatusFilter(value === ALL ? '' : value)
    setPage(1)
  }
  const handleCategory = (value: string) => {
    setCategoryFilter(value === ALL ? '' : value)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = !!(search || statusFilter || categoryFilter)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My expenses"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
              data-testid="export-csv"
            >
              <Download />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            <Button asChild size="sm">
              <Link to="/expenses/new">
                <Plus />
                New expense
              </Link>
            </Button>
          </div>
        }
      />

      {/* Filters toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-sm">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by title…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
            aria-label="Search expenses"
          />
        </div>

        <Select value={statusFilter || ALL} onValueChange={handleStatus}>
          <SelectTrigger className="w-[10rem]" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {formatCategory(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={categoryFilter || ALL} onValueChange={handleCategory}>
          <SelectTrigger className="w-[11rem]" aria-label="Filter by category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {ALL_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {formatCategory(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isPending ? (
        <div
          className="overflow-hidden rounded-lg border bg-card shadow-sm"
          role="status"
          aria-live="polite"
        >
          <span className="sr-only">Loading expenses…</span>
          <div className="border-b bg-muted/40 px-4 py-3">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="divide-y">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ) : isError ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="Could not load expenses"
          description="There was a problem fetching your expenses. Please try again."
          action={
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : expenses.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title="No expenses found"
          description={
            hasFilters
              ? 'Try adjusting your filters.'
              : 'When you file an expense it will appear here.'
          }
          action={
            !hasFilters ? (
              <Button asChild size="sm">
                <Link to="/expenses/new">
                  <Plus />
                  File your first expense
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <ExpenseTable
            expenses={expenses}
            tableTestId="my-expenses-table"
            rowTestId={(id) => `my-expense-row-${id}`}
            statusTestId={(id) => `my-expense-status-${id}`}
            sort={sort}
            onSort={handleSort}
          />
        </div>
      )}

      {/* Pagination */}
      {!isPending && !isError && total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages} — {total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
