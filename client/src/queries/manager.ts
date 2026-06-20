import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import api from '@/services/api'
import type { ApiResponse, ManagerStats } from '@/types'
import { unwrapData } from './utils'

/** Query keys for the manager module. */
export const managerKeys = {
  all: ['manager'] as const,
  stats: ['manager', 'stats'] as const,
}

/** GET /manager/stats — the manager dashboard summary. */
export function useManagerStats(opts?: {
  enabled?: boolean
}): UseQueryResult<ManagerStats, Error> {
  return useQuery({
    queryKey: managerKeys.stats,
    queryFn: async () => unwrapData(await api.get<ApiResponse<ManagerStats>>('/manager/stats')),
    enabled: opts?.enabled ?? true,
  })
}
