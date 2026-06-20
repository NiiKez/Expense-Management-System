import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, X, MessageSquare, Send } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppNotification } from '@/types'
import {
  useUnreadCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/queries/notifications'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const TYPE_ICON: Record<string, LucideIcon> = {
  EXPENSE_SUBMITTED: Send,
  EXPENSE_RESUBMITTED: Send,
  EXPENSE_APPROVED: Check,
  EXPENSE_REJECTED: X,
  EXPENSE_COMMENT: MessageSquare,
}

const TYPE_TONE: Record<string, string> = {
  EXPENSE_SUBMITTED: 'text-primary',
  EXPENSE_RESUBMITTED: 'text-primary',
  EXPENSE_APPROVED: 'text-success',
  EXPENSE_REJECTED: 'text-destructive',
  EXPENSE_COMMENT: 'text-muted-foreground',
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  // The badge count is polled every 30s (refetchInterval lives in the hook) and
  // kept in sync by the optimistic mark-read mutations below.
  const { data: unread = 0 } = useUnreadCount()

  // The list is only fetched while the popover is open (enabled gate). The hook
  // normalizes is_read to a real boolean.
  const { data: list, isPending: listPending } = useNotifications(
    { page: 1, pageSize: 10 },
    { enabled: open },
  )
  const items = list?.items ?? []
  // While open, RQ may keep a fetch in flight; only show the loader before the
  // first list payload exists.
  const loading = open && listPending

  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  const handleOpenItem = (n: AppNotification) => {
    setOpen(false)
    // The mutation is optimistic + reconciles inside the hook (item flip + badge
    // decrement + invalidation), so no manual local state to manage here.
    if (!n.is_read) markRead.mutate(n.id)
    if (n.expense_id) navigate(`/expenses/${n.expense_id}`)
  }

  const handleMarkAll = () => {
    markAll.mutate()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
          data-testid="notification-bell"
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span
              data-testid="notification-badge"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={handleMarkAll}
              data-testid="notification-mark-all"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul className="divide-y" data-testid="notification-list">
              {items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell
                const isUnread = !n.is_read
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleOpenItem(n)}
                      data-testid={`notification-item-${n.id}`}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                        isUnread && 'bg-primary-subtle/40',
                      )}
                    >
                      <Icon className={cn('mt-0.5 size-4 shrink-0', TYPE_TONE[n.type])} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug">{n.message}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {formatRelativeTime(n.created_at)}
                        </span>
                      </span>
                      {isUnread && (
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
