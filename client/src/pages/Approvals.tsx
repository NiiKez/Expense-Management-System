import { useState } from 'react'
import ApprovalCard from '../components/approval/ApprovalCard'
import { usePendingApprovals, useApproveExpense, useRejectExpense } from '@/queries/approvals'
import PageHeader from '@/components/common/PageHeader'
import EmptyState from '@/components/common/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

export default function Approvals() {
  const [page, setPage] = useState(1)
  const pageSize = 20

  const { data, isPending, isError } = usePendingApprovals({ page, pageSize })
  const expenses = data?.items ?? []
  const total = data?.total ?? 0
  const meta = data?.meta

  const approve = useApproveExpense()
  const reject = useRejectExpense()

  // The mutation hooks remove the item optimistically and invalidate the right
  // caches; we just surface toasts and re-throw so ApprovalCard can show its
  // own inline error state on failure.
  const handleApprove = async (id: number) => {
    try {
      await approve.mutateAsync(id)
    } catch (err) {
      toast.error('Could not approve the expense. It may have already been actioned — refresh and try again.')
      throw err
    }
  }

  const handleReject = async (id: number, reason: string) => {
    try {
      await reject.mutateAsync({ id, reason })
    } catch (err) {
      toast.error('Could not reject the expense. It may have already been actioned — refresh and try again.')
      throw err
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending approvals"
        description="Expenses submitted by your team, awaiting your review."
        actions={
          total > 0 ? (
            <Badge variant="warning" className="text-sm">
              {total} pending
            </Badge>
          ) : undefined
        }
      />

      {isError && (
        <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load pending approvals.
        </p>
      )}

      {isPending ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <span className="sr-only">Loading pending approvals…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-xl border bg-card p-4"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-8 w-44" />
            </div>
          ))}
        </div>
      ) : expenses.length === 0 ? (
        <EmptyState
          icon={<CheckCheck className="size-6 text-success" />}
          title="All caught up"
          description={
            meta?.source === 'graph'
              ? 'No pending expenses from your direct reports.'
              : 'No pending expenses from your team.'
          }
          data-testid="approvals-empty"
        />
      ) : (
        <>
          <div className="space-y-2" data-testid="approvals-grid">
            {expenses.map((expense) => (
              <ApprovalCard
                key={expense.id}
                expense={expense}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages} — {total} pending
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="approvals-pagination-prev"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-4" />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="approvals-pagination-next"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
