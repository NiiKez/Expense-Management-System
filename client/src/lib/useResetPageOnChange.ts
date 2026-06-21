import { useState } from 'react'

/**
 * Keeps a paginated list's page in lock-step with a filter/search value: when
 * `resetKey` changes, the page snaps back to 1. Returns the page the *current*
 * render should use — the render that first sees a new `resetKey` returns 1
 * directly (so the first request never carries the stale page/key combo) and
 * commits the reset in the same render.
 *
 * Uses React's documented "adjust state during render" pattern (a previous-value
 * state slice, not a ref) so it stays synchronous and lint-clean. `setPage` is
 * expected to be the stable setter from `useState`.
 */
export function useResetPageOnChange(
  resetKey: unknown,
  page: number,
  setPage: (page: number) => void,
): number {
  const [prevKey, setPrevKey] = useState(resetKey)
  if (prevKey !== resetKey) {
    setPrevKey(resetKey)
    setPage(1)
    return 1
  }
  return page
}
