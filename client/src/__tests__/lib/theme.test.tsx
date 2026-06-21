import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/lib/theme'

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

describe('ThemeProvider', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to dark and reflects it on <html> + localStorage', () => {
    renderHook(() => useTheme(), { wrapper })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('toggle flips the theme and persists the choice', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe('dark')

    act(() => result.current.toggle())

    expect(result.current.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('keeps a stable context value + toggle identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useTheme(), { wrapper })
    const firstValue = result.current
    const firstToggle = result.current.toggle

    rerender()

    // Memoized provider value: unchanged theme ⇒ same object/callback identity,
    // so useTheme consumers don't re-render on unrelated provider renders.
    expect(result.current).toBe(firstValue)
    expect(result.current.toggle).toBe(firstToggle)
  })
})
