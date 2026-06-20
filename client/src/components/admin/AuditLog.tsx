import { useState, useMemo } from 'react'
import type { ComponentProps } from 'react'
import { useAuditLogs, useUsers, type AuditLogParams } from '@/queries/admin'
import { AuditAction } from '@/types'
import type { Status } from '@/types'
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
import { nextSort, type SortState } from '@/lib/sort'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatRelativeTime, formatDate } from '@/lib/format'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { downloadFile } from '@/lib/download'
import { toast } from 'sonner'
import { ArrowRight, ChevronLeft, ChevronRight, Download, ScrollText } from 'lucide-react'

// ─── Filter state ────────────────────────────────────────────────────────────

interface Filters {
  expenseId: string
  performedBy: string
  action: string
  dateFrom: string
  dateTo: string
}

const INITIAL_FILTERS: Filters = {
  expenseId: '',
  performedBy: '',
  action: '',
  dateFrom: '',
  dateTo: '',
}

// Sentinel value for the "all" option — Radix Select disallows an empty-string value.
const ALL = '__all__'

const PAGE_SIZE = 20

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  OVERRIDDEN: 'Overridden',
  UPDATED: 'Updated',
  DELETED: 'Deleted',
}

type BadgeVariant = ComponentProps<typeof Badge>['variant']

const ACTION_VARIANT: Record<string, BadgeVariant> = {
  SUBMITTED: 'info',
  RESUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  OVERRIDDEN: 'warning',
  UPDATED: 'secondary',
  DELETED: 'danger',
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? (action.charAt(0) + action.slice(1).toLowerCase())
}

/**
 * Extracts a concise, human-readable summary from audit log details.
 * Deliberately hides raw version counters and dumps of full objects.
 */
function readableDetails(details: Record<string, unknown> | null): string | null {
  if (!details) return null

  const parts: string[] = []

  // Rejection reason
  const reason = details.rejection_reason ?? details.reason
  if (typeof reason === 'string' && reason.trim()) {
    parts.push(`Reason: "${reason.trim()}"`)
  }

  // Override summary (old→new amount)
  if (details.override_from != null && details.override_to != null) {
    parts.push(`Override: ${details.override_from} → ${details.override_to}`)
  }

  // Changed amount (update action)
  if (details.amount != null && details.override_from == null) {
    parts.push(`Amount: ${details.amount}`)
  }

  // Updated field names (show them, not the raw values)
  if (Array.isArray(details.updated_fields) && (details.updated_fields as unknown[]).length > 0) {
    const fields = (details.updated_fields as unknown[])
      .map(String)
      .filter((f) => f !== 'version' && f !== 'updated_at')
      .join(', ')
    if (fields) parts.push(`Fields changed: ${fields}`)
  }

  // Title changed
  if (typeof details.title === 'string' && details.title.trim()) {
    parts.push(`Title: "${details.title.trim()}"`)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AuditLog() {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [sort, setSort] = useState<SortState>({ key: null, order: 'desc' })
  const [exporting, setExporting] = useState(false)

  // Users for name resolution (also feeds the performer dropdown).
  const { data: usersData } = useUsers()
  const users = useMemo(() => usersData ?? [], [usersData])
  const userMap = useMemo<Map<number, string>>(() => {
    const m = new Map<number, string>()
    for (const u of users) m.set(u.id, u.display_name)
    return m
  }, [users])

  // Debounce the free-text expense-ID filter so typing fires one request per pause.
  const debouncedExpenseId = useDebouncedValue(filters.expenseId, 300)

  const params = useMemo<AuditLogParams>(() => {
    const p: AuditLogParams = { page, pageSize: PAGE_SIZE }
    if (debouncedExpenseId) p.expense_id = debouncedExpenseId
    if (filters.performedBy) p.performed_by = filters.performedBy
    if (filters.action) p.action = filters.action
    if (filters.dateFrom) p.date_from = filters.dateFrom
    if (filters.dateTo) p.date_to = filters.dateTo
    if (sort.key) {
      p.sort = sort.key
      p.order = sort.order
    }
    return p
  }, [page, debouncedExpenseId, filters.performedBy, filters.action, filters.dateFrom, filters.dateTo, sort])

  const { data, isPending, isError, refetch } = useAuditLogs(params)
  const logs = data?.items ?? []
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

  const hasFilters = Object.values(filters).some(Boolean)

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS)
    setPage(1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params: Record<string, string> = {}
      if (filters.expenseId) params.expense_id = filters.expenseId
      if (filters.performedBy) params.performed_by = filters.performedBy
      if (filters.action) params.action = filters.action
      if (filters.dateFrom) params.date_from = filters.dateFrom
      if (filters.dateTo) params.date_to = filters.dateTo
      if (sort.key) {
        params.sort = sort.key
        params.order = sort.order
      }
      await downloadFile('/admin/audit-logs/export', params, 'audit-logs.csv')
    } catch {
      toast.error('Failed to export audit log.')
    } finally {
      setExporting(false)
    }
  }

  // ── Performer dropdown: distinct known users, sorted by name
  const performerOptions = useMemo(() => {
    const entries: { id: number; name: string }[] = []
    const seen = new Set<number>()
    for (const u of users) {
      if (!seen.has(u.id)) {
        seen.add(u.id)
        entries.push({ id: u.id, name: u.display_name })
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }, [users])

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <Input
          type="text"
          placeholder="Expense ID"
          value={filters.expenseId}
          onChange={(e) => handleFilterChange('expenseId', e.target.value)}
          aria-label="Filter by expense ID"
          className="w-28 font-mono tabular-nums"
        />
        {/* Performer: always a ui Select (no element-type swapping) */}
        <Select
          value={filters.performedBy || ALL}
          onValueChange={(v) => handleFilterChange('performedBy', v === ALL ? '' : v)}
        >
          <SelectTrigger className="h-9 w-[170px]" aria-label="Filter by user">
            <SelectValue placeholder="All users" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All users</SelectItem>
            {performerOptions.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.action || ALL}
          onValueChange={(v) => handleFilterChange('action', v === ALL ? '' : v)}
        >
          <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by action">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actions</SelectItem>
            {Object.values(AuditAction).map((a) => (
              <SelectItem key={a} value={a}>{actionLabel(a)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
          aria-label="From date"
          title="From date"
          className="w-[150px]"
        />
        <Input
          type="date"
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

      {total > 0 && !isPending && (
        <p className="text-sm text-muted-foreground">{total.toLocaleString()} audit {total !== 1 ? 'entries' : 'entry'}</p>
      )}

      {isPending ? (
        <div className="space-y-2 rounded-lg border p-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={<ScrollText className="size-6" />}
          title="Couldn’t load the audit trail"
          description="Failed to load audit logs."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-6" />}
          title="No audit entries"
          description={
            hasFilters
              ? 'No audit entries match the current filters.'
              : 'No activity has been recorded yet.'
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader label="Expense" sortKey="expense" sort={sort} onSort={handleSort} />
                  <SortableHeader label="Action" sortKey="action" sort={sort} onSort={handleSort} />
                  <SortableHeader label="Performed by" sortKey="actor" sort={sort} onSort={handleSort} />
                  <TableHead>Status change</TableHead>
                  <TableHead>Details</TableHead>
                  <SortableHeader label="When" sortKey="when" sort={sort} onSort={handleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const details = readableDetails(log.details)
                  const actorName = userMap.get(log.performed_by) ?? `User #${log.performed_by}`
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                        #{String(log.expense_id).padStart(4, '0')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ACTION_VARIANT[log.action] ?? 'secondary'}>
                          {actionLabel(log.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{actorName}</TableCell>
                      <TableCell
                        aria-label={
                          log.old_status || log.new_status
                            ? `Status changed from ${log.old_status ?? 'none'} to ${log.new_status ?? 'none'}`
                            : undefined
                        }
                      >
                        {log.old_status || log.new_status ? (
                          <span className="flex items-center gap-1.5">
                            {log.old_status ? (
                              <StatusBadge status={log.old_status as Status} />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                            {log.new_status ? (
                              <StatusBadge status={log.new_status as Status} />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-sm text-muted-foreground">
                        {details ?? <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell
                        className="text-sm text-muted-foreground"
                        title={formatDate(log.created_at)}
                      >
                        {formatRelativeTime(log.created_at)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
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
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
