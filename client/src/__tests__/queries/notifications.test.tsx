import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../helpers/renderWithProviders'
import type { AppNotification } from '../../types'
import { NotificationType } from '../../types'

jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
jest.mock('@/services/api')
import api from '@/services/api'
import {
  useUnreadCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  notificationKeys,
  type NotificationList,
  type NotificationListParams,
} from '@/queries/notifications'

const mockedApi = api as jest.Mocked<typeof api>

function makeNotification(id: number, isRead: boolean | number): AppNotification {
  return {
    id,
    user_id: 1,
    type: NotificationType.EXPENSE_APPROVED,
    expense_id: 7,
    actor_id: 2,
    message: `msg ${id}`,
    // The wire may send a MySQL TINYINT (0/1); cast to model that raw payload so
    // we can assert useNotifications normalizes it via Boolean() on ingress.
    is_read: isRead as unknown as boolean,
    created_at: '2024-02-01T00:00:00Z',
  }
}

const params: NotificationListParams = { page: 1, pageSize: 10 }

beforeEach(() => jest.clearAllMocks())

describe('useUnreadCount', () => {
  it('GETs /notifications/unread-count and returns the count number', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: { count: 4 } } })
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useUnreadCount(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/notifications/unread-count')
    expect(result.current.data).toBe(4)
  })
})

describe('useNotifications', () => {
  it('GETs /notifications, normalizes is_read to boolean, reads meta.unread', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: [makeNotification(1, 0), makeNotification(2, 1)], meta: { unread: 1 } },
    })
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useNotifications(params, { enabled: true }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/notifications', { params })
    expect(result.current.data?.unread).toBe(1)
    expect(result.current.data?.items.map((n) => n.is_read)).toEqual([false, true])
  })

  it('does not fetch when not enabled', () => {
    const { wrapper } = createQueryWrapper()
    renderHook(() => useNotifications(params, { enabled: false }), { wrapper })
    expect(mockedApi.get).not.toHaveBeenCalled()
  })
})

describe('useMarkNotificationRead', () => {
  it('PATCHes read, optimistically flips item + decrements unread, invalidates', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: { success: true } })
    const { client, wrapper } = createQueryWrapper()
    const listKey = notificationKeys.list(params)
    client.setQueryData<NotificationList>(listKey, {
      items: [makeNotification(1, false), makeNotification(2, false)],
      unread: 2,
    })
    client.setQueryData<number>(notificationKeys.unreadCount, 2)
    const spy = jest.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper })
    result.current.mutate(1)

    await waitFor(() => {
      const cached = client.getQueryData<NotificationList>(listKey)
      expect(cached?.items.find((n) => n.id === 1)?.is_read).toBe(true)
    })
    expect(client.getQueryData<number>(notificationKeys.unreadCount)).toBe(1)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.patch).toHaveBeenCalledWith('/notifications/1/read')
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(notificationKeys.unreadCount))
    expect(keys).toContain(JSON.stringify(notificationKeys.listRoot))
  })

  it('rolls back the unread count when the request fails', async () => {
    mockedApi.patch.mockRejectedValueOnce(new Error('boom'))
    const { client, wrapper } = createQueryWrapper()
    client.setQueryData<number>(notificationKeys.unreadCount, 2)
    client.setQueryData<NotificationList>(notificationKeys.list(params), {
      items: [makeNotification(1, false)],
      unread: 2,
    })

    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper })
    result.current.mutate(1)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryData<number>(notificationKeys.unreadCount)).toBe(2)
  })

  it('skips an already-read item in the cached list (guard: no re-flip / no double-decrement)', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: { success: true } })
    const { client, wrapper } = createQueryWrapper()
    const listKey = notificationKeys.list(params)
    // #1 is already read; the `target.is_read` guard must leave this list entry
    // (and its embedded unread tally) untouched rather than decrement again.
    client.setQueryData<NotificationList>(listKey, {
      items: [makeNotification(1, true), makeNotification(2, false)],
      unread: 1,
    })

    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper })
    result.current.mutate(1)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.patch).toHaveBeenCalledWith('/notifications/1/read')
    const cached = client.getQueryData<NotificationList>(listKey)
    expect(cached?.unread).toBe(1)
    expect(cached?.items.map((n) => n.is_read)).toEqual([true, false])
  })
})

describe('useMarkAllNotificationsRead', () => {
  it('POSTs read-all, zeroes unread optimistically', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } })
    const { client, wrapper } = createQueryWrapper()
    const listKey = notificationKeys.list(params)
    client.setQueryData<NotificationList>(listKey, {
      items: [makeNotification(1, false), makeNotification(2, false)],
      unread: 2,
    })
    client.setQueryData<number>(notificationKeys.unreadCount, 2)

    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper })
    result.current.mutate()

    await waitFor(() => expect(client.getQueryData<number>(notificationKeys.unreadCount)).toBe(0))
    expect(client.getQueryData<NotificationList>(listKey)?.items.every((n) => n.is_read)).toBe(true)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.post).toHaveBeenCalledWith('/notifications/read-all')
  })

  it('invalidates the unread-count + list-root on settle', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } })
    const { client, wrapper } = createQueryWrapper()
    const spy = jest.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper })
    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // onSettled reconciles the optimistic zeroing with the server.
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(notificationKeys.unreadCount))
    expect(keys).toContain(JSON.stringify(notificationKeys.listRoot))
  })

  it('rollback clears the optimistic 0 badge when no prior count was cached', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('boom'))
    const { client, wrapper } = createQueryWrapper()
    client.setQueryData<NotificationList>(notificationKeys.list(params), {
      items: [makeNotification(1, false)],
      unread: 1,
    })
    // Deliberately do NOT seed the unread-count query (snapshot === undefined).

    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper })
    result.current.mutate()

    await waitFor(() => expect(result.current.isError).toBe(true))
    // onMutate optimistically set the badge to 0; rollback must clear it back to
    // undefined (not leave it stuck at 0) so the next poll repopulates it.
    expect(client.getQueryData<number>(notificationKeys.unreadCount)).toBeUndefined()
  })
})
