import { useCallback, useEffect, useState } from 'react'
import type { ComponentProps } from 'react'
import api from '../services/api'
import type { ApiResponse, ManagerEmployee, ResponseMeta, Role } from '../types'
import PageHeader from '@/components/common/PageHeader'
import EmptyState from '@/components/common/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCategory } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RefreshCw, Users } from 'lucide-react'

type BadgeVariant = ComponentProps<typeof Badge>['variant']

const ROLE_VARIANT: Record<Role, BadgeVariant> = {
  ADMIN: 'info',
  MANAGER: 'secondary',
  EMPLOYEE: 'outline',
}

export default function ManagerEmployees() {
  const [employees, setEmployees] = useState<ManagerEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<ResponseMeta | undefined>(undefined)

  const fetchEmployees = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError('')
    try {
      const res = await api.get<ApiResponse<ManagerEmployee[]>>('/manager/employees', {
        params: forceRefresh ? { forceRefresh: true } : undefined,
      })
      setEmployees(res.data.data ?? [])
      setMeta(res.data.meta)
    } catch {
      setError('Failed to load your team directory.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchEmployees()
  }, [fetchEmployees])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Your direct reports."
        actions={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Refresh"
            onClick={() => fetchEmployees(true)}
            disabled={refreshing || loading}
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          </Button>
        }
      />

      {error && (
        <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <div className="space-y-2 rounded-lg border p-2" role="status" aria-live="polite">
          <span className="sr-only">Loading team…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="No direct reports"
          description={
            meta?.source === 'graph'
              ? 'Microsoft Graph returned no direct reports for your account.'
              : 'No employees were found for your manager relationship.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell className="font-medium">
                    {employee.displayName}
                  </TableCell>
                  <TableCell className="text-sm">
                    {employee.jobTitle ?? <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                  <TableCell>
                    {employee.department ? (
                      <Badge variant="outline">{employee.department}</Badge>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {employee.mail ?? <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                  <TableCell>
                    {employee.appUser ? (
                      <Badge variant={ROLE_VARIANT[employee.appUser.role]}>
                        {formatCategory(employee.appUser.role)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {employee.appUser ? (
                      employee.appUser.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground/50">Not synced</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            {employees.length} {employees.length === 1 ? 'member' : 'members'}
          </div>
        </div>
      )}
    </div>
  )
}
