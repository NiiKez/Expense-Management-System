import { useParams } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useExpense } from '@/queries/expenses'
import ExpenseForm from '../components/expenses/ExpenseForm'
import PageHeader from '@/components/common/PageHeader'
import EmptyState from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

function getExpenseId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export default function EditExpense() {
  const { id } = useParams<{ id: string }>()
  const expenseId = getExpenseId(id)
  // An unparseable / out-of-range id is a permanent, non-retryable error;
  // a valid id that fails to load is retryable. Passing null skips the fetch.
  const isInvalidRef = expenseId === null

  const {
    data: expense,
    isPending,
    isError,
    refetch,
  } = useExpense(expenseId)

  // The query is disabled for an invalid id, so it never leaves its pending
  // state — short-circuit to the invalid-reference error instead.
  if (isInvalidRef) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit expense" />
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="Invalid expense reference."
        />
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-7 w-40" />
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    )
  }

  if (isError || !expense) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit expense" />
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title={isError ? 'Failed to load expense. Please try again.' : 'Expense not found.'}
          action={
            isError ? (
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Try again
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit expense"
        description="Update the details for this expense."
      />
      <ExpenseForm mode="edit" initial={expense} expenseId={expense.id} />
    </div>
  )
}
