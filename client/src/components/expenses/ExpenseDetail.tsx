import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, FileText, Image as ImageIcon } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import type { Receipt } from '@/types'
import { Role, Status } from '@/types'
import {
  useExpense,
  useExpenseComments,
  useAddComment,
  useDeleteExpense,
  fetchReceiptBlob,
} from '@/queries/expenses'
import { useApproveExpense, useRejectExpense } from '@/queries/approvals'
import { formatCurrency, formatDate, formatRelativeTime, formatFileSize, formatCategory } from '@/lib/format'
import StatusBadge from '@/components/expenses/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'

const DOWNLOADABLE_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const PREVIEWABLE_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png'])

function getExpenseId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const numericId = Number(value)
  return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null
}

function isValidReceiptId(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

function sanitizeDownloadName(fileName: string) {
  const sanitized = Array.from(fileName, (char) => {
    if (char.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(char)) {
      return '_'
    }
    return char
  })
    .join('')
    .trim()
  return sanitized || 'receipt'
}

function getApiErrorMessage(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { error?: { message?: string } } } }
  if (e?.response?.status === 409) {
    return 'This expense changed since you opened it — please reload.'
  }
  return e?.response?.data?.error?.message ?? 'An unexpected error occurred.'
}

export default function ExpenseDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const expenseId = getExpenseId(id)

  // The detail + comments thread auto-refetch off the query cache; the approve/
  // reject hooks invalidate ['expenses','detail',id], so the status updates here
  // with no manual refetch glue.
  const expenseQuery = useExpense(expenseId)
  const commentsQuery = useExpenseComments(expenseId)
  const expense = expenseQuery.data
  const comments = commentsQuery.data ?? []

  const addComment = useAddComment()
  const deleteExpense = useDeleteExpense()
  const approveExpense = useApproveExpense()
  const rejectExpense = useRejectExpense()

  // Local UI error (receipt preview/download + invalid reference).
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Reject dialog state
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectReasonError, setRejectReasonError] = useState('')

  // Add-comment input
  const [commentBody, setCommentBody] = useState('')

  const handlePostComment = () => {
    if (!expenseId || !commentBody.trim() || addComment.isPending) return
    addComment.mutate(
      { id: expenseId, body: commentBody.trim() },
      {
        onSuccess: () => setCommentBody(''),
        onError: (err) => toast.error(getApiErrorMessage(err)),
      },
    )
  }

  // Revoke object URL on cleanup
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handlePreview = async (receipt: Receipt) => {
    if (
      !expenseId ||
      !isValidReceiptId(receipt.id) ||
      !PREVIEWABLE_RECEIPT_TYPES.has(receipt.mime_type)
    ) {
      setError('Receipt preview is not available for this file.')
      return
    }
    try {
      setError('')
      const data = await fetchReceiptBlob(expenseId, receipt.id)
      const blob = new Blob([data], { type: receipt.mime_type })
      const url = URL.createObjectURL(blob)
      // Cleanup effect on previewUrl handles revoking previous URL when state changes.
      setPreviewUrl(url)
    } catch {
      setError('Failed to load receipt preview.')
    }
  }

  const handleDownload = async (receipt: Receipt) => {
    if (
      !expenseId ||
      !isValidReceiptId(receipt.id) ||
      !DOWNLOADABLE_RECEIPT_TYPES.has(receipt.mime_type)
    ) {
      setError('Receipt download is not available for this file.')
      return
    }
    try {
      setError('')
      const data = await fetchReceiptBlob(expenseId, receipt.id)
      const blob = new Blob([data], { type: receipt.mime_type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = sanitizeDownloadName(receipt.file_name)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setError('Failed to download receipt.')
    }
  }

  const closePreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  const handleDelete = () => {
    if (!expenseId) return
    deleteExpense.mutate(expenseId, {
      onSuccess: () => {
        toast.success('Expense deleted successfully.')
        navigate('/')
      },
      onError: (err) => {
        toast.error(getApiErrorMessage(err))
        setDeleteOpen(false)
      },
    })
  }

  const handleApprove = () => {
    if (!expenseId) return
    approveExpense.mutate(expenseId, {
      onSuccess: () => toast.success('Expense approved.'),
      onError: (err) => toast.error(getApiErrorMessage(err)),
    })
  }

  const handleRejectConfirm = () => {
    if (!expenseId) return
    if (!rejectReason.trim()) {
      setRejectReasonError('A reason is required.')
      return
    }
    rejectExpense.mutate(
      { id: expenseId, reason: rejectReason.trim() },
      {
        onSuccess: () => {
          toast.success('Expense rejected.')
          setRejectOpen(false)
          setRejectReason('')
          setRejectReasonError('')
        },
        onError: (err) => toast.error(getApiErrorMessage(err)),
      },
    )
  }

  if (expenseId === null) {
    return <div className="text-sm text-destructive py-4">Invalid expense reference.</div>
  }

  if (expenseQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 py-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (expenseQuery.isError && !expense) {
    return <div className="text-sm text-destructive py-4">Failed to load expense details.</div>
  }
  if (!expense) {
    return <div className="text-sm text-destructive py-4">Expense not found.</div>
  }

  const receipts = expense.receipts ?? []

  const isOwner = user !== null && expense.submitted_by === user.id
  const isPending = expense.status === Status.PENDING
  const isManagerOrAdmin =
    user !== null && (user.role === Role.MANAGER || user.role === Role.ADMIN)

  // Show owner actions: Edit + Delete when owner AND pending
  const showOwnerActions = isOwner && isPending
  // Show "Edit & resubmit" when the owner's expense was rejected
  const showResubmit = isOwner && expense.status === Status.REJECTED
  // Show approval actions: Approve + Reject when (manager or admin) AND pending AND not owner
  const showApprovalActions = isManagerOrAdmin && isPending && !isOwner

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-4" data-testid="expense-detail">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          data-testid="expense-detail-back"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="size-4" />
          Back
        </button>

        {/* Contextual action buttons */}
        <div className="flex items-center gap-2">
          {showResubmit && (
            <Button asChild size="sm" data-testid="detail-resubmit">
              <Link to={`/expenses/${expenseId}/edit`}>Edit &amp; resubmit</Link>
            </Button>
          )}

          {showOwnerActions && (
            <>
              <Button asChild variant="outline" size="sm" data-testid="detail-edit">
                <Link to={`/expenses/${expenseId}/edit`}>Edit</Link>
              </Button>

              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm" data-testid="detail-delete">
                    Delete
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete expense</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. The expense and all its receipts will be
                      permanently removed.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setDeleteOpen(false)}
                      disabled={deleteExpense.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={deleteExpense.isPending}
                      data-testid="detail-confirm-delete"
                    >
                      {deleteExpense.isPending ? 'Deleting…' : 'Delete'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}

          {showApprovalActions && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleApprove}
                disabled={approveExpense.isPending}
                data-testid="detail-approve"
              >
                {approveExpense.isPending ? 'Approving…' : 'Approve'}
              </Button>

              <Dialog
                open={rejectOpen}
                onOpenChange={(open) => {
                  setRejectOpen(open)
                  if (!open) {
                    setRejectReason('')
                    setRejectReasonError('')
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm" data-testid="detail-reject">
                    Reject
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Reject expense</DialogTitle>
                    <DialogDescription>
                      Provide a reason for rejecting this expense. The submitter will be able to
                      see this.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Textarea
                      data-testid="detail-reject-reason"
                      placeholder="Reason for rejection…"
                      value={rejectReason}
                      onChange={(e) => {
                        setRejectReason(e.target.value)
                        if (e.target.value.trim()) setRejectReasonError('')
                      }}
                      rows={4}
                      aria-label="Reason for rejection"
                      aria-invalid={!!rejectReasonError}
                      aria-describedby={rejectReasonError ? 'detail-reject-error' : undefined}
                    />
                    {rejectReasonError && (
                      <p id="detail-reject-error" role="alert" className="text-sm text-destructive">
                        {rejectReasonError}
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setRejectOpen(false)}
                      disabled={rejectExpense.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleRejectConfirm}
                      disabled={rejectExpense.isPending}
                      data-testid="detail-confirm-reject"
                    >
                      {rejectExpense.isPending ? 'Rejecting…' : 'Confirm reject'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* Main detail card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h1
                className="text-2xl font-semibold leading-tight"
                data-testid="expense-detail-title"
              >
                {expense.title}
              </h1>
              <p className="text-sm text-muted-foreground">
                {formatCategory(expense.category)}
              </p>
            </div>
            <StatusBadge
              status={expense.status}
              data-testid="expense-detail-status"
              className="mt-1 shrink-0"
            />
          </div>
          <p className="pt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">
            {formatCurrency(expense.amount, expense.currency)}
          </p>
        </CardHeader>

        <CardContent>
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Category</dt>
              <dd className="mt-1 text-sm">{formatCategory(expense.category)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Date incurred</dt>
              <dd className="mt-1 text-sm">{formatDate(expense.expense_date)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Filed</dt>
              <dd className="mt-1 text-sm">{formatDate(expense.created_at)}</dd>
            </div>
            {expense.submitter_name && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Submitted by</dt>
                <dd className="mt-1 text-sm">{expense.submitter_name}</dd>
              </div>
            )}
            {expense.description && (
              <div className="col-span-full">
                <dt className="text-sm font-medium text-muted-foreground">Description</dt>
                <dd className="mt-1 text-sm whitespace-pre-wrap">{expense.description}</dd>
              </div>
            )}
            {expense.rejection_reason && (
              <div className="col-span-full">
                <dt className="text-sm font-medium text-destructive">Rejection reason</dt>
                <dd className="mt-1 text-sm whitespace-pre-wrap text-destructive">
                  {expense.rejection_reason}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Receipts section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Receipts</h2>
            <span className="text-sm text-muted-foreground">
              {receipts.length === 0
                ? 'No receipts'
                : `${receipts.length} receipt${receipts.length !== 1 ? 's' : ''}`}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No receipts attached.</p>
          ) : (
            <ul className="space-y-3">
              {receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className="flex items-center justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
                      {PREVIEWABLE_RECEIPT_TYPES.has(receipt.mime_type) ? (
                        <ImageIcon className="size-4" />
                      ) : (
                        <FileText className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="receipt-name truncate text-sm font-medium">{receipt.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(receipt.file_size)} ·{' '}
                        {(receipt.mime_type.split('/')[1] ?? receipt.mime_type).toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {PREVIEWABLE_RECEIPT_TYPES.has(receipt.mime_type) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handlePreview(receipt)}
                      >
                        Preview
                      </Button>
                    )}
                    {DOWNLOADABLE_RECEIPT_TYPES.has(receipt.mime_type) && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDownload(receipt)}
                      >
                        Download
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Comments thread */}
      <Card data-testid="comments-section">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Comments</h2>
            <span className="text-sm text-muted-foreground">
              {comments.length === 0
                ? 'No comments'
                : `${comments.length} comment${comments.length !== 1 ? 's' : ''}`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {commentsQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No comments yet. Start the conversation below.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="comment-list">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg border p-3" data-testid={`comment-${c.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.author_name ?? 'User'}</span>
                    {c.author_role && (
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                        {c.author_role}
                      </Badge>
                    )}
                    <span
                      className="text-xs text-muted-foreground"
                      title={formatDate(c.created_at)}
                    >
                      {formatRelativeTime(c.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm">{c.body}</p>
                </li>
              ))}
            </ul>
          )}

          {/* Add a comment */}
          <div className="space-y-2 border-t pt-4">
            <Textarea
              data-testid="comment-input"
              placeholder="Add a comment…"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              maxLength={2000}
              aria-label="Add a comment"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handlePostComment}
                disabled={addComment.isPending || !commentBody.trim()}
                data-testid="comment-submit"
              >
                {addComment.isPending ? 'Posting…' : 'Post comment'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Receipt image preview */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Receipt preview</DialogTitle>
            <DialogDescription className="sr-only">
              A preview of the selected receipt image.
            </DialogDescription>
          </DialogHeader>
          {previewUrl && (
            <div className="flex max-h-[75vh] justify-center overflow-auto rounded-md border bg-muted/30 p-2">
              <img
                src={previewUrl}
                alt="Receipt preview"
                className="max-h-[70vh] max-w-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
