import React from 'react'
import { render, screen } from '@testing-library/react'
import StatusBadge from '@/components/expenses/StatusBadge'

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
