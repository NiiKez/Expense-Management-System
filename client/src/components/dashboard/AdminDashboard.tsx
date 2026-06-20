import { useAdminStats, useAdminExpenses } from '@/queries/admin'
import StatCard from '@/components/dashboard/StatCard'
import SpendTrendChart from '@/components/dashboard/SpendTrendChart'
import SpendByCategoryChart from '@/components/dashboard/SpendByCategoryChart'
import ExpenseTable from '@/components/expenses/ExpenseTable'
import EmptyState from '@/components/common/EmptyState'
import PageHeader from '@/components/common/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/format'
import { Wallet, Clock, Users, CircleCheck } from 'lucide-react'

export default function AdminDashboard() {
  const {
    data: stats,
    isPending: statsLoading,
    isError: statsError,
  } = useAdminStats()
  const {
    data: recentPage,
    isPending: recentLoading,
    isError: recentError,
  } = useAdminExpenses({ page: 1, pageSize: 5 })
  const recent = recentPage?.items ?? []

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
            description="There was a problem fetching organisation statistics. Try refreshing the page."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Org spend MTD"
              value={formatCurrency(stats.orgSpendMonth, stats.baseCurrency)}
              icon={Wallet}
            />
            <StatCard
              label="Pending org-wide"
              value={String(stats.pendingOrgWide)}
              icon={Clock}
            />
            <StatCard
              label="Active users"
              value={String(stats.activeUsers)}
              icon={Users}
            />
            <StatCard
              label="Approved MTD"
              value={formatCurrency(stats.approvedMonth, stats.baseCurrency)}
              icon={CircleCheck}
            />
          </div>
        )}
      </section>

      {/* Charts */}
      {!statsLoading && stats && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Monthly spend trend</CardTitle>
            </CardHeader>
            <CardContent>
              <SpendTrendChart data={stats.monthly ?? []} currency={stats.baseCurrency} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <CardTitle>Spend by category</CardTitle>
              <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                {formatCurrency(
                  (stats.byCategory ?? []).reduce((sum, c) => sum + c.total, 0),
                  stats.baseCurrency,
                )}
              </span>
            </CardHeader>
            <CardContent>
              <SpendByCategoryChart data={stats.byCategory ?? []} currency={stats.baseCurrency} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent activity */}
      <section>
        <PageHeader title="Recent activity" />
        <div className="mt-4">
          {recentLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : recentError ? (
            <EmptyState
              title="Could not load recent expenses"
              description="There was a problem fetching recent activity. Try refreshing the page."
            />
          ) : recent.length === 0 ? (
            <EmptyState
              title="No recent expenses"
              description="There are no expenses to display yet."
            />
          ) : (
            <div className="overflow-x-auto">
              <ExpenseTable
                expenses={recent}
                tableTestId="admin-recent-table"
                rowTestId={(id) => `admin-recent-row-${id}`}
                statusTestId={(id) => `admin-recent-status-${id}`}
                showSubmitter
              />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
