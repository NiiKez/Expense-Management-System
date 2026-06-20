import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import api from '@/services/api'
import type { ApiResponse, PaginatedResponse, AppNotification } from '@/types'
import { unwrapData } from './utils'

export interface NotificationListParams {
  page: number
  pageSize: number
}

/** The normalized notifications-list payload (items + server unread count). */
export interface NotificationList {
  items: AppNotification[]
  unread: number
}

/** Query keys for the notifications module. */
export const notificationKeys = {
  all: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  listRoot: ['notifications', 'list'] as const,
  list: (params: NotificationListParams) => ['notifications', 'list', params] as const,
}

/** Context carried from onMutate to onError for optimistic-rollback. */
interface NotificationMutationContext {
  listSnapshots: Array<[readonly unknown[], NotificationList | undefined]>
  unreadSnapshot: number | undefined
}

/**
 * GET /notifications/unread-count — the badge count. Polls every 30s so the
 * bell stays fresh without a websocket. The endpoint returns `{ count }`.
 */
export function useUnreadCount(opts?: { enabled?: boolean }): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: async () =>
      unwrapData(await api.get<ApiResponse<{ count: number }>>('/notifications/unread-count'))
        .count,
    enabled: opts?.enabled ?? true,
    refetchInterval: 30_000,
  })
}

/**
 * GET /notifications — the recent notifications list. Gated by `opts.enabled`
 * (typically only fetched while the popover is open). `is_read` is normalized
 * to a real boolean (the API may send MySQL TINYINT 0/1).
 */
export function useNotifications(
  params: NotificationListParams,
  opts: { enabled: boolean },
): UseQueryResult<NotificationList, Error> {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<AppNotification>>('/notifications', { params })
      const items = (res.data.data ?? []).map((n) => ({ ...n, is_read: Boolean(n.is_read) }))
      return { items, unread: res.data.meta?.unread ?? 0 }
    },
    enabled: opts.enabled,
  })
}

/**
 * PATCH /notifications/{id}/read — marks one notification read.
 * Optimistic: flips the item to read in every cached list and decrements the
 * badge, rolling back on error, then invalidates to reconcile.
 */
export function useMarkNotificationRead(): UseMutationResult<
  void,
  Error,
  number,
  NotificationMutationContext
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.patch(`/notifications/${id}/read`)
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: notificationKeys.all })
      const listEntries = qc.getQueriesData<NotificationList>({ queryKey: notificationKeys.listRoot })
      const listSnapshots: NotificationMutationContext['listSnapshots'] = listEntries.map(
        ([key, data]) => [key, data],
      )
      const unreadSnapshot = qc.getQueryData<number>(notificationKeys.unreadCount)

      for (const [key, data] of listEntries) {
        if (!data) continue
        const target = data.items.find((n) => n.id === id)
        if (!target || target.is_read) continue
        qc.setQueryData<NotificationList>(key, {
          items: data.items.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
          unread: Math.max(0, data.unread - 1),
        })
      }
      if (typeof unreadSnapshot === 'number') {
        qc.setQueryData<number>(notificationKeys.unreadCount, Math.max(0, unreadSnapshot - 1))
      }
      return { listSnapshots, unreadSnapshot }
    },
    onError: (_err, _id, context) => {
      context?.listSnapshots.forEach(([key, data]) => qc.setQueryData(key, data))
      if (context && typeof context.unreadSnapshot === 'number') {
        qc.setQueryData<number>(notificationKeys.unreadCount, context.unreadSnapshot)
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount })
      void qc.invalidateQueries({ queryKey: notificationKeys.listRoot })
    },
  })
}

/**
 * POST /notifications/read-all — marks every notification read.
 * Optimistic: flips all cached items to read and zeroes the badge.
 */
export function useMarkAllNotificationsRead(): UseMutationResult<
  void,
  Error,
  void,
  NotificationMutationContext
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.post('/notifications/read-all')
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: notificationKeys.all })
      const listEntries = qc.getQueriesData<NotificationList>({ queryKey: notificationKeys.listRoot })
      const listSnapshots: NotificationMutationContext['listSnapshots'] = listEntries.map(
        ([key, data]) => [key, data],
      )
      const unreadSnapshot = qc.getQueryData<number>(notificationKeys.unreadCount)

      for (const [key, data] of listEntries) {
        if (!data) continue
        qc.setQueryData<NotificationList>(key, {
          items: data.items.map((n) => ({ ...n, is_read: true })),
          unread: 0,
        })
      }
      qc.setQueryData<number>(notificationKeys.unreadCount, 0)
      return { listSnapshots, unreadSnapshot }
    },
    onError: (_err, _vars, context) => {
      context?.listSnapshots.forEach(([key, data]) => qc.setQueryData(key, data))
      if (context && typeof context.unreadSnapshot === 'number') {
        qc.setQueryData<number>(notificationKeys.unreadCount, context.unreadSnapshot)
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount })
      void qc.invalidateQueries({ queryKey: notificationKeys.listRoot })
    },
  })
}
