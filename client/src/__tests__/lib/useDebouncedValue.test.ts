import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 300))
    expect(result.current).toBe('a')
  })

  it('does not update until the delay elapses', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    })

    rerender({ v: 'ab' })
    expect(result.current).toBe('a') // still old value before delay

    act(() => {
      jest.advanceTimersByTime(299)
    })
    expect(result.current).toBe('a')

    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(result.current).toBe('ab')
  })

  it('collapses rapid changes into a single trailing update', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    })

    rerender({ v: 'ab' })
    act(() => jest.advanceTimersByTime(100))
    rerender({ v: 'abc' })
    act(() => jest.advanceTimersByTime(100))
    rerender({ v: 'abcd' })

    // Only 200ms passed across the keystrokes; debounce should not have fired.
    expect(result.current).toBe('a')

    act(() => jest.advanceTimersByTime(300))
    expect(result.current).toBe('abcd')
  })
})
