import { render, screen } from '@testing-library/react'
import { Receipt } from 'lucide-react'
import StatCard from '@/components/dashboard/StatCard'

// Direct unit tests for the delta/sub branches. The dashboards only ever pass
// `label`/`value`/`icon`, so these paths are otherwise unexercised.
describe('StatCard', () => {
  it('renders only the label and value when no delta or sub is given', () => {
    const { container } = render(<StatCard label="Total submitted" value="7" icon={Receipt} />)

    expect(screen.getByText('Total submitted')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    // The delta/sub row is gated behind `(delta || sub)` — it must not render.
    expect(container.querySelector('.lucide-trending-up')).toBeNull()
    expect(container.querySelector('.lucide-trending-down')).toBeNull()
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  it('renders an upward indicator for a positive delta', () => {
    const { container } = render(
      <StatCard label="Team spend" value="$4,200" delta={{ value: 12, direction: 'up' }} />,
    )

    // Up arrow + success colouring, with the magnitude shown as a percentage.
    expect(container.querySelector('.lucide-trending-up')).not.toBeNull()
    expect(container.querySelector('.lucide-trending-down')).toBeNull()
    const badge = screen.getByText('12%')
    expect(badge).toHaveClass('text-success')
  })

  it('renders a downward indicator for a negative delta and shows its absolute value', () => {
    const { container } = render(
      <StatCard label="Team spend" value="$4,200" delta={{ value: -5, direction: 'down' }} />,
    )

    // Down arrow + destructive colouring; the sign is dropped via Math.abs.
    expect(container.querySelector('.lucide-trending-down')).not.toBeNull()
    expect(container.querySelector('.lucide-trending-up')).toBeNull()
    const badge = screen.getByText('5%')
    expect(badge).toHaveClass('text-destructive')
  })

  it('renders the sub line when supplied', () => {
    render(<StatCard label="Approved" value="$3,100" sub="vs. last month" />)

    expect(screen.getByText('vs. last month')).toBeInTheDocument()
  })
})
