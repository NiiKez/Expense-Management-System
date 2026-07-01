import React from 'react'
import { render, screen } from '@testing-library/react'
import StatusBadge from '@/components/expenses/StatusBadge'
import type { Status } from '@/types'

it('renders the status text', () => {
  render(<StatusBadge status="APPROVED" />)
  expect(screen.getByText('APPROVED')).toBeInTheDocument()
})

it('renders PENDING text', () => {
  render(<StatusBadge status="PENDING" />)
  expect(screen.getByText('PENDING')).toBeInTheDocument()
})

it('renders REJECTED text', () => {
  render(<StatusBadge status="REJECTED" />)
  expect(screen.getByText('REJECTED')).toBeInTheDocument()
})

it('forwards data-testid and other span props', () => {
  render(<StatusBadge status="PENDING" data-testid="expense-row-status-1" />)
  expect(screen.getByTestId('expense-row-status-1')).toBeInTheDocument()
  expect(screen.getByTestId('expense-row-status-1')).toHaveTextContent('PENDING')
})

it('renders a neutral fallback for an unknown status instead of crashing', () => {
  // An audit-log row can carry a status the client does not model; the badge
  // must degrade gracefully rather than throw on the config lookup.
  expect(() =>
    render(<StatusBadge status={'CANCELLED' as Status} data-testid="unknown-status" />),
  ).not.toThrow()
  expect(screen.getByTestId('unknown-status')).toHaveTextContent('CANCELLED')
})

// ── Colour signal (data-variant on the underlying Badge span) ──────────────────
// Text alone doesn't convey urgency; the variant drives the colour + ring so a
// dropped/renamed mapping (e.g. REJECTED silently rendering green) is caught here.

it('signals PENDING with the warning variant and shows a status icon', () => {
  render(<StatusBadge status="PENDING" data-testid="badge" />)
  const badge = screen.getByTestId('badge')
  expect(badge).toHaveAttribute('data-variant', 'warning')
  // A recognised status renders its lucide glyph alongside the label.
  expect(badge.querySelector('svg')).not.toBeNull()
})

it('signals APPROVED with the success variant', () => {
  render(<StatusBadge status="APPROVED" data-testid="badge" />)
  expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'success')
})

it('signals REJECTED with the danger variant', () => {
  render(<StatusBadge status="REJECTED" data-testid="badge" />)
  expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'danger')
})

it('uses the neutral secondary variant and no icon for an unknown status', () => {
  render(<StatusBadge status={'CANCELLED' as Status} data-testid="badge" />)
  const badge = screen.getByTestId('badge')
  expect(badge).toHaveAttribute('data-variant', 'secondary')
  // No config entry → no icon is rendered (only the raw label text).
  expect(badge.querySelector('svg')).toBeNull()
})
