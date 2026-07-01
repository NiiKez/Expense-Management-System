import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/lib/theme'
import ThemeToggle from '@/components/layout/ThemeToggle'

// The useTheme hook itself is covered in lib/theme.test; here we drive the
// component through the real provider and assert the click wiring + label swap.
function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

describe('ThemeToggle', () => {
  // Provider defaults to dark; clear so each test starts from that known state.
  beforeEach(() => localStorage.clear())

  it('starts in dark mode and offers to switch to light', () => {
    renderToggle()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByText('Switch to light mode')).toBeInTheDocument()
    expect(screen.queryByText('Switch to dark mode')).not.toBeInTheDocument()
  })

  it('toggles to light on click, swapping the label and <html> class', async () => {
    renderToggle()

    await userEvent.click(screen.getByTestId('theme-toggle'))

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(screen.getByText('Switch to dark mode')).toBeInTheDocument()
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('toggles back to dark on a second click', async () => {
    renderToggle()

    const toggle = screen.getByTestId('theme-toggle')
    await userEvent.click(toggle)
    await userEvent.click(toggle)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByText('Switch to light mode')).toBeInTheDocument()
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})
