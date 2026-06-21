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
