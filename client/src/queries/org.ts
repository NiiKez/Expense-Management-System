import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import api from '@/services/api'
import type { ApiResponse, OrgTree, OrgUserDetail } from '@/types'
import { unwrapData } from './utils'

/** Query keys for the org-hierarchy module. Co-located, not centralized. */
export const orgKeys = {
  all: ['org'] as const,
  tree: (maxDepth?: number) => ['org', 'tree', maxDepth ?? null] as const,
  user: (id: number) => ['org', 'user', id] as const,
}

/**
 * GET /org/tree — the org reporting hierarchy. ADMIN gets the whole org; MANAGER
 * gets the subtree rooted at themselves. Served from the cached directory
 * (users.manager_id), so it carries a longer staleTime like the other
 * directory-backed reads. maxDepth only bounds the MANAGER subtree walk.
 */
export function useOrgTree(opts?: {
  maxDepth?: number
  enabled?: boolean
}): UseQueryResult<OrgTree, Error> {
  return useQuery({
    queryKey: orgKeys.tree(opts?.maxDepth),
    queryFn: async () =>
      unwrapData(
        await api.get<ApiResponse<OrgTree>>('/org/tree', {
          params: opts?.maxDepth ? { maxDepth: opts.maxDepth } : undefined,
        }),
      ),
    enabled: opts?.enabled ?? true,
    staleTime: 5 * 60_000,
  })
}

/**
 * GET /org/users/:id — the detail behind a single org-chart node. Fetched lazily
 * (only when a node is opened) by passing the selected id; pass null to keep it
 * idle. The server maps id→entra_id, re-checks visibility, and enriches from
 * Microsoft Graph for real sessions (falling back to the DB row otherwise).
 */
export function useOrgUser(id: number | null): UseQueryResult<OrgUserDetail, Error> {
  return useQuery({
    queryKey: orgKeys.user(id ?? 0),
    queryFn: async () =>
      unwrapData(await api.get<ApiResponse<OrgUserDetail>>(`/org/users/${id}`)),
    enabled: id != null,
    staleTime: 5 * 60_000,
  })
}
