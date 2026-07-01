import React from 'react'
import { render, screen } from '@testing-library/react'

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub

// ResponsiveContainer measures a 0×0 box in jsdom, so the chart SVG never
// mounts. Clone the child with an explicit size so recharts renders the axis
// text the component controls (see SpendByCategoryChart.test.tsx for the same).
jest.mock('recharts', () => {
  const O = jest.requireActual('recharts')
  return {
    ...O,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children as React.ReactElement<{ width?: number; height?: number }>, {
        width: 400,
        height: 300,
      }),
  }
})

import type { MonthlyTotal } from '@/types'
import SpendTrendChart from '@/components/dashboard/SpendTrendChart'

describe('SpendTrendChart', () => {
  it('renders the empty state when there is no data', () => {
    render(<SpendTrendChart data={[]} />)

    expect(screen.getByText('No monthly spend data available.')).toBeInTheDocument()
  })

  it('renders the period labels along the X axis for non-empty data', async () => {
    const data: MonthlyTotal[] = [
      { month: '2024-01', total: 1200 },
      { month: '2024-02', total: 900 },
    ]
    render(<SpendTrendChart data={data} currency="USD" />)

    // The empty branch is skipped and each period appears on the X axis.
    expect(screen.queryByText('No monthly spend data available.')).not.toBeInTheDocument()
    expect((await screen.findAllByText('2024-01')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('2024-02').length).toBeGreaterThan(0)
  })

  it('coerces DECIMAL-string and NaN totals via `Number(d.total) || 0` without crashing', async () => {
    // A DECIMAL string must be parsed to a real number (so the value axis scales
    // to it) and a malformed value must coerce to 0 rather than poisoning the
    // domain with NaN.
    const data = [
      { month: '2024-01', total: '50' },
      { month: '2024-02', total: 'oops' },
    ] as unknown as MonthlyTotal[]
    const { container } = render(<SpendTrendChart data={data} currency="USD" />)

    // Periods render (component didn't crash) …
    expect((await screen.findAllByText('2024-01')).length).toBeGreaterThan(0)
    // … the value axis carries finite currency ticks derived from the coerced
    // "50", and nothing rendered as NaN (the guard that keeps the domain finite).
    expect(container.textContent).toContain('$')
    expect(container.textContent).not.toContain('NaN')
    expect(screen.getAllByText('$45.00').length).toBeGreaterThan(0)
  })
})
