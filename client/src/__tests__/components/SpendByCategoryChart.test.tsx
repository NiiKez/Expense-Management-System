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

// ResponsiveContainer measures a 0×0 box in jsdom and renders nothing, so the
// SVG (axis ticks, bar labels) never mounts. Give the chart a fixed size by
// cloning its child with explicit width/height — then recharts renders the
// axis/label text the component actually controls.
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

import { Category } from '@/types'
import type { CategoryTotal } from '@/types'
import SpendByCategoryChart from '@/components/dashboard/SpendByCategoryChart'

describe('SpendByCategoryChart', () => {
  it('renders the empty state when there is no data', () => {
    render(<SpendByCategoryChart data={[]} />)

    expect(screen.getByText('No category spend data available.')).toBeInTheDocument()
  })

  it('renders title-cased category labels and per-bar totals for non-empty data', async () => {
    const data: CategoryTotal[] = [
      { category: Category.TRAVEL, count: 2, total: 100 },
      { category: Category.MEALS, count: 1, total: 50 },
    ]
    render(<SpendByCategoryChart data={data} currency="USD" />)

    // The empty branch is skipped …
    expect(screen.queryByText('No category spend data available.')).not.toBeInTheDocument()
    // … and the YAxis renders each category via titleCaseEnum (TRAVEL → Travel).
    // recharts emits the tick text more than once, so match all occurrences.
    expect((await screen.findAllByText('Travel')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Meals').length).toBeGreaterThan(0)
    // The LabelList renders the formatted total next to each bar.
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0)
  })

  it('coerces DECIMAL-string and NaN totals via `Number(d.total) || 0` without crashing', async () => {
    // The API serialises DECIMAL columns as strings; a malformed value must not
    // white-screen the chart — it should coerce to 0.
    const data = [
      { category: Category.TRAVEL, count: 1, total: '75.50' },
      { category: Category.MEALS, count: 1, total: 'not-a-number' },
    ] as unknown as CategoryTotal[]
    render(<SpendByCategoryChart data={data} currency="USD" />)

    // The string total is parsed to a real number for the label …
    expect((await screen.findAllByText('$75.50')).length).toBeGreaterThan(0)
    // … and the NaN value coerces to 0 (rendered as $0.00, not "$NaN").
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0)
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })
})
