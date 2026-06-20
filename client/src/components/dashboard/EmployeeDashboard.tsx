import { Link } from 'react-router-dom'
import { useMeStats } from '@/queries/me'
import { useExpenses } from '@/queries/expenses'
import StatCard from '@/components/dashboard/StatCard'
import SpendByCategoryChart from '@/components/dashboard/SpendByCategoryChart'
import ExpenseTable from '@/components/expenses/ExpenseTable'
import EmptyState from '@/components/common/EmptyState'
import PageHeader from '@/components/common/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Receipt, Clock, CircleCheck, XCircle } from 'lucide-react'

export default function EmployeeDashboard() {
  const {
    data: stats,
    isPending: statsLoading,
    isError: statsError,
  } = useMeStats()
  const {
    data: expensesPage,
    isPending: expensesLoading,
    isError: expensesError,
  } = useExpenses({ page: 1, pageSize: 20 })
  const expenses = expensesPage?.items ?? []

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
            description="There was a problem fetching your expense statistics. Try refreshing the page."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Total submitted"
              value={String(stats.totals.submitted)}
              icon={Receipt}
            />
            <StatCard
              label="Pending"
              value={String(stats.totals.pending)}
              icon={Clock}
            />
            <StatCard
              label="Approved this month"
              value={formatCurrency(stats.approvedAmountMonth, stats.baseCurrency)}
              icon={CircleCheck}
            />
            <StatCard
              label="Rejected"
              value={String(stats.totals.rejected)}
              icon={XCircle}
            />
          </div>
        )}
      </section>

      {/* Category chart */}
      {!statsLoading && stats && (
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
      )}

      {/* Expense table */}
      <section>
        <PageHeader
          title="Your expenses"
          actions={
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/expenses">View all</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/expenses/new">+ New expense</Link>
              </Button>
            </div>
          }
        />
        <div className="mt-4">
          {expensesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : expensesError ? (
            <EmptyState
              title="Could not load expenses"
              description="There was a problem fetching your expenses. Try refreshing the page."
            />
          ) : expenses.length === 0 ? (
            <EmptyState
              title="No expenses yet"
              description="When you file an expense it will appear here."
              action={
                <Button asChild size="sm">
                  <Link to="/expenses/new">File your first expense</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <ExpenseTable
                expenses={expenses}
                tableTestId="dashboard-expense-table"
                rowTestId={(id) => `expense-row-${id}`}
                statusTestId={(id) => `expense-row-status-${id}`}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
