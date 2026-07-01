import { useState } from 'react'
import { renderHook } from '@testing-library/react'
import { useResetPageOnChange } from '@/lib/useResetPageOnChange'

describe('useResetPageOnChange', () => {
  it('returns the given page and never resets while the reset key is stable', () => {
    const setPage = jest.fn()
    const { result, rerender } = renderHook(
      ({ page }) => useResetPageOnChange('same-key', page, setPage),
      { initialProps: { page: 4 } },
    )

    expect(result.current).toBe(4)

    // Page can advance freely; a stable key must not trigger a reset.
    rerender({ page: 5 })
    expect(result.current).toBe(5)
    expect(setPage).not.toHaveBeenCalled()
  })

  it('snaps the page back to 1 the moment the reset key changes', () => {
    // Real page state so we prove the effective page settles to 1 — i.e. the
    // stale page (3) can never slip into the first request under the new key.
    const setPageSpy = jest.fn()
    const seen: number[] = []

    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) => {
        const [page, setPage] = useState(3)
        // Wrap the real setter so we can both drive state and count reset calls.
        const trackedSetPage = (p: number) => {
          setPageSpy(p)
          setPage(p)
        }
        const effective = useResetPageOnChange(resetKey, page, trackedSetPage)
        seen.push(effective)
        return effective
      },
      { initialProps: { resetKey: 'a' } },
    )

    expect(result.current).toBe(3)

    rerender({ resetKey: 'b' })

    // The very render that first sees the new key returns 1 (not the stale 3)...
    expect(seen).toContain(1)
    expect(seen.indexOf(1)).toBeGreaterThan(0)
    expect(seen[seen.indexOf(1) - 1]).toBe(3)
    // ...and after React re-runs with the committed reset, the page is 1.
    expect(result.current).toBe(1)
    // The reset fires exactly once for a single key change.
    expect(setPageSpy).toHaveBeenCalledTimes(1)
    expect(setPageSpy).toHaveBeenCalledWith(1)
  })
})
