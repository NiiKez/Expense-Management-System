import { useMemo, useState } from 'react'
import { Role } from '@/types'
import { useUsers } from '@/queries/admin'
import { useAuth } from '@/context/AuthContext'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { formatCategory } from '@/lib/format'
import { Search, Users } from 'lucide-react'
import type { ComponentProps } from 'react'

type BadgeVariant = ComponentProps<typeof Badge>['variant']

const ROLE_VARIANT: Record<Role, BadgeVariant> = {
  ADMIN: 'info',
  MANAGER: 'secondary',
  EMPLOYEE: 'outline',
}

// Sentinel value for the "all" option — Radix Select disallows an empty-string value.
const ALL = '__all__'

export default function UserManagement() {
  const { user: currentUser } = useAuth()
  const { data, isPending, isError, refetch } = useUsers()
  const users = useMemo(() => data ?? [], [data])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')

  // Build id → display_name map for manager resolution
  const userMap = useMemo<Map<number, string>>(() => {
    const m = new Map<number, string>()
    for (const u of users) m.set(u.id, u.display_name)
    return m
  }, [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false
      if (!q) return true
      return (
        u.display_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      )
    })
  }, [users, search, roleFilter])

  const counts = useMemo(() => {
    return users.reduce(
      (acc, u) => {
        acc.total += 1
        if (u.role === Role.ADMIN) acc.admin += 1
        if (u.role === Role.MANAGER) acc.manager += 1
        if (u.role === Role.EMPLOYEE) acc.employee += 1
        return acc
      },
      { total: 0, admin: 0, manager: 0, employee: 0 },
    )
  }, [users])

  const hasFilters = Boolean(search || roleFilter)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
            className="pl-9"
          />
        </div>
        <Select
          value={roleFilter || ALL}
          onValueChange={(v) => setRoleFilter(v === ALL ? '' : v)}
        >
          <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by role">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            {Object.values(Role).map((r) => (
              <SelectItem key={r} value={r}>{formatCategory(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => { setSearch(''); setRoleFilter('') }}
          disabled={!hasFilters}
        >
          Clear
        </Button>
      </div>

      {/* Stats */}
      {!isPending && users.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span>{counts.total} users total</span>
          <span>{counts.admin} admin · {counts.manager} manager · {counts.employee} employee</span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Roles are managed centrally in Entra ID App Roles. This view is read-only.
      </p>

      {isPending ? (
        <div className="space-y-2 rounded-lg border p-2" role="status" aria-live="polite">
          <span className="sr-only">Loading users…</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="Couldn’t load users"
          description="Failed to load users."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="No users found"
          description="No users match these filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Manager</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => {
                const isSelf = u.id === currentUser?.id
                const managerName = u.manager_id != null
                  ? (userMap.get(u.manager_id) ?? `User #${u.manager_id}`)
                  : '—'
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {u.display_name}
                        {isSelf && (
                          <Badge variant="outline" className="py-0 text-xs">you</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ROLE_VARIANT[u.role]}>{formatCategory(u.role)}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {managerName}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
