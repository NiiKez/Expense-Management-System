import { Link } from 'react-router-dom'
import { useManagerStats } from '@/queries/manager'
import { usePendingApprovals } from '@/queries/approvals'
import StatCard from '@/components/dashboard/StatCard'
import SpendTrendChart from '@/components/dashboard/SpendTrendChart'
import EmptyState from '@/components/common/EmptyState'
import PageHeader from '@/components/common/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, formatDateShort } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Clock, Wallet, CircleCheck, Users } from 'lucide-react'

export default function ManagerDashboard() {
  const {
    data: stats,
    isPending: statsLoading,
    isError: statsError,
  } = useManagerStats()
  const {
    data: pendingPage,
    isPending: pendingLoading,
    isError: pendingError,
  } = usePendingApprovals({ page: 1, pageSize: 5 })
  const pending = pendingPage?.items ?? []

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <section>
        {statsLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : statsError || !stats ? (
          <EmptyState
            title="Could not load stats"
            description="There was a problem fetching manager statistics. Try refreshing the page."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Pending approvals"
              value={String(stats.pendingApprovals)}
              icon={Clock}
            />
            <StatCard
              label="Team spend MTD"
              value={formatCurrency(stats.teamSpendMonth, stats.baseCurrency)}
              icon={Wallet}
            />
            <StatCard
              label="Approved MTD"
              value={formatCurrency(stats.approvedMonth, stats.baseCurrency)}
              icon={CircleCheck}
            />
            <StatCard
              label="Team size"
              value={String(stats.teamSize)}
              icon={Users}
            />
          </div>
        )}
      </section>

      {/* Spend trend chart */}
      {!statsLoading && stats && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly spend trend</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendTrendChart data={stats.monthly ?? []} currency={stats.baseCurrency} />
          </CardContent>
        </Card>
      )}

      {/* Pending approvals preview */}
      <section>
        <PageHeader
          title="Pending approvals"
          actions={
            <Button asChild size="sm" variant="outline">
              <Link to="/approvals">View all</Link>
            </Button>
          }
        />
        <div className="mt-4">
          {pendingLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : pendingError ? (
            <EmptyState
              title="Could not load pending approvals"
              description="There was a problem fetching pending approvals. Try refreshing the page."
            />
          ) : pending.length === 0 ? (
            <EmptyState
              title="No pending approvals"
              description="Your team has no expenses waiting for review."
            />
          ) : (
            <div className="divide-y rounded-lg border">
              {pending.map((exp) => (
                <Link
                  key={exp.id}
                  to="/approvals"
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{exp.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {exp.submitter_name ?? '—'} &middot; {formatDateShort(exp.expense_date)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatCurrency(exp.amount, exp.currency)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
