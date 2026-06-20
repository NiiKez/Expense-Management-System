import { QueryClient } from '@tanstack/react-query'

/**
 * Builds a QueryClient with the app-wide defaults.
 *
 * - staleTime 30s: data stays "fresh" for 30s so revisiting a screen within
 *   that window serves cache instead of refetching.
 * - gcTime 5min: unused cache entries are garbage-collected after 5 minutes.
 * - retry 1: one automatic retry on a failed query (network blip tolerance).
 * - refetchOnWindowFocus off: this is a back-office app, not a live feed — a
 *   refetch every time the tab regains focus is noise, not signal.
 * - mutations retry 0: never silently re-run a write; surface the error.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 300_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}

/** The singleton client used by the running app (tests build their own). */
export const queryClient = createQueryClient()
