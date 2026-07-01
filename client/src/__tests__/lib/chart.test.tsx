import { render, screen } from '@testing-library/react'
import {
  ChartTooltip,
  categoryColor,
  titleCaseEnum,
  CATEGORY_CHART_COLORS,
  CHART_FALLBACK_COLOR,
} from '@/lib/chart'

describe('categoryColor', () => {
  it('maps a known category to its palette CSS var', () => {
    expect(categoryColor('TRAVEL')).toBe(CATEGORY_CHART_COLORS.TRAVEL)
  })

  it('falls back for an unknown category', () => {
    expect(categoryColor('NOT_A_CATEGORY')).toBe(CHART_FALLBACK_COLOR)
  })
})

describe('titleCaseEnum', () => {
  it('title-cases a single-word enum', () => {
    expect(titleCaseEnum('EQUIPMENT')).toBe('Equipment')
  })

  it('title-cases an UPPER_SNAKE enum across separators', () => {
    expect(titleCaseEnum('OFFICE_SUPPLIES')).toBe('Office Supplies')
  })
})

describe('ChartTooltip', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<ChartTooltip active={false} payload={[{ value: 5 }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the payload is empty', () => {
    const { container } = render(<ChartTooltip active payload={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there is no payload at all', () => {
    const { container } = render(<ChartTooltip active />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the label and the value formatted in the default USD currency', () => {
    render(<ChartTooltip active label="Travel" payload={[{ value: 100 }]} />)
    expect(screen.getByText('Travel')).toBeInTheDocument()
    expect(screen.getByText('$100.00')).toBeInTheDocument()
  })

  it('coerces a non-numeric value to 0 via Number(value)||0', () => {
    render(<ChartTooltip active label="Travel" payload={[{ value: 'abc' }]} />)
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('honours an explicitly supplied currency', () => {
    render(<ChartTooltip active label="Travel" currency="EUR" payload={[{ value: 50 }]} />)
    // Symbol placement is locale-dependent; assert the amount and euro sign show.
    expect(screen.getByText(/50\.00/)).toBeInTheDocument()
    expect(screen.getByText(/€/)).toBeInTheDocument()
  })

  it('renders a singular count row when count is 1', () => {
    render(<ChartTooltip active label="Meals" payload={[{ value: 20, payload: { count: 1 } }]} />)
    expect(screen.getByText('1 expense')).toBeInTheDocument()
  })

  it('renders a plural count row when count is greater than 1', () => {
    render(<ChartTooltip active label="Meals" payload={[{ value: 60, payload: { count: 3 } }]} />)
    expect(screen.getByText('3 expenses')).toBeInTheDocument()
  })

  it('omits the count row when no numeric count is present', () => {
    render(<ChartTooltip active label="Meals" payload={[{ value: 60 }]} />)
    expect(screen.queryByText(/expenses?$/)).not.toBeInTheDocument()
  })
})
