import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Expense } from '../../types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatCategory, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Check, X } from 'lucide-react'

interface ApprovalCardProps {
  expense: Expense
  onApprove: (id: number) => Promise<void>
  onReject: (id: number, reason: string) => Promise<void>
}

const MAX_REJECTION_REASON_LENGTH = 500

export default function ApprovalCard({ expense, onApprove, onReject }: ApprovalCardProps) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const id = expense.id
  const ref = `#${String(id).padStart(4, '0')}`
  const submitter = expense.submitter_name ?? `User #${expense.submitted_by}`

  const handleApprove = async () => {
    setLoading(true)
    setError('')
    try {
      await onApprove(id)
    } catch {
      setError('Failed to approve expense.')
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      setError('A reason is required.')
      return
    }
    if (trimmedReason.length > MAX_REJECTION_REASON_LENGTH) {
      setError(`Reason must be ${MAX_REJECTION_REASON_LENGTH} characters or fewer.`)
      return
    }
    setLoading(true)
    setError('')
    try {
      await onReject(id, trimmedReason)
    } catch {
      setError('Failed to reject expense.')
    } finally {
      setLoading(false)
    }
  }

  return (
    // IMPORTANT: this <article> element, its class, and data-testid are part of
    // the Playwright e2e contract — do NOT change the tag, class, or testid format.
    <article
      className={cn(
        'approval-card group',
        'rounded-xl border bg-card text-card-foreground shadow-sm transition-colors',
        'hover:border-border/80 hover:bg-muted/20',
      )}
      data-testid={`approval-card-${id}`}
    >
      {/* Primary scannable row: ref · title · submitter · category · date · amount · actions */}
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
        {/* Identity block */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {ref}
            </span>
            {/* approval-card-title class is part of the e2e contract */}
            <Link
              to={`/expenses/${id}`}
              className="approval-card-title truncate text-sm font-semibold leading-snug hover:underline"
              title={expense.title}
            >
              {expense.title}
            </Link>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground/80">{submitter}</span>
            <span aria-hidden>·</span>
            <span>{formatCategory(expense.category)}</span>
            <span aria-hidden>·</span>
            <span title={`Filed ${formatRelativeTime(expense.created_at)}`}>
              {formatRelativeTime(expense.expense_date)}
            </span>
          </div>
          {expense.description && (
            <p
              className="mt-1.5 line-clamp-1 text-xs text-muted-foreground/80"
              title={expense.description}
            >
              {expense.description}
            </p>
          )}
        </div>

        {/* Amount */}
        <div className="shrink-0 sm:text-right">
          <p className="font-mono text-base font-semibold tabular-nums">
            {formatCurrency(Number(expense.amount), expense.currency)}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {expense.currency}
          </p>
        </div>

        {/* Inline actions */}
        {!rejecting && (
          <div className="flex shrink-0 gap-2">
            {/* data-testid is part of the e2e contract */}
            <Button
              type="button"
              variant="success"
              size="sm"
              data-testid={`approval-approve-${id}`}
              onClick={handleApprove}
              disabled={loading}
            >
              <Check className="size-4" />
              {loading ? 'Approving…' : 'Approve'}
            </Button>
            {/* data-testid is part of the e2e contract */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={`approval-reject-${id}`}
              onClick={() => setRejecting(true)}
              disabled={loading}
            >
              <X className="size-4" />
              Reject
            </Button>
          </div>
        )}
      </div>

      {/* Error message — data-testid is part of the e2e contract */}
      {error && (
        <p
          className="mx-4 mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid={`approval-error-${id}`}
        >
          {error}
        </p>
      )}

      {/* Inline reject form — toggled by the reject button above */}
      {rejecting && (
        <div className="flex flex-col gap-3 border-t bg-muted/20 p-4">
          <label className="text-sm font-medium" htmlFor={`reject-${id}`}>
            Reason for rejection
          </label>
          {/* data-testid is part of the e2e contract */}
          <Textarea
            id={`reject-${id}`}
            data-testid={`approval-reject-reason-${id}`}
            placeholder="Explain why this expense is being rejected…"
            maxLength={MAX_REJECTION_REASON_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
          <div className="flex gap-2">
            {/* data-testid is part of the e2e contract */}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid={`approval-confirm-reject-${id}`}
              onClick={handleReject}
              disabled={loading}
            >
              <X className="size-4" />
              {loading ? 'Rejecting…' : 'Confirm rejection'}
            </Button>
            {/* data-testid is part of the e2e contract */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={`approval-cancel-reject-${id}`}
              onClick={() => {
                setRejecting(false)
                setReason('')
                setError('')
              }}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  )
}
