import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import api from '@/services/api'
import type { ApiResponse, User, UserPreferences, MeStats } from '@/types'
import { unwrapData } from './utils'

/** Query keys for the current-user module. Co-located, not centralized. */
export const meKeys = {
  all: ['me'] as const,
  me: ['me'] as const,
  stats: ['me', 'stats'] as const,
  preferences: ['me', 'preferences'] as const,
}

/** GET /me — the authenticated user's profile. */
export function useMe(opts?: { enabled?: boolean }): UseQueryResult<User, Error> {
  return useQuery({
    queryKey: meKeys.me,
    queryFn: async () => unwrapData(await api.get<ApiResponse<User>>('/me')),
    enabled: opts?.enabled ?? true,
  })
}

/** GET /me/stats — the employee dashboard summary for the current user. */
export function useMeStats(opts?: { enabled?: boolean }): UseQueryResult<MeStats, Error> {
  return useQuery({
    queryKey: meKeys.stats,
    queryFn: async () => unwrapData(await api.get<ApiResponse<MeStats>>('/me/stats')),
    enabled: opts?.enabled ?? true,
  })
}

/**
 * PATCH /me/preferences — saves self-service settings and refreshes the cached
 * profile (the `/me` payload carries the same notify_* / default_currency
 * fields) so the rest of the app sees the change immediately.
 */
export function useUpdatePreferences(): UseMutationResult<
  UserPreferences,
  Error,
  UserPreferences
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UserPreferences) =>
      unwrapData(await api.patch<ApiResponse<UserPreferences>>('/me/preferences', body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meKeys.me })
    },
  })
}
