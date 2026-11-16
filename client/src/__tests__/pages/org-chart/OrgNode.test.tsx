import type { FC } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OrgTreeNode } from '@/types'
import type { OrgNodeData } from '@/pages/org-chart/layout'

// React Flow's Handle needs a provider context; stub it (and Position) so the
// node renders standalone in jsdom without a ReactFlowProvider.
jest.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))

import OrgNode from '@/pages/org-chart/OrgNode'
import { OrgChartActionsContext } from '@/pages/org-chart/context'

function node(extra: Partial<OrgTreeNode> = {}): OrgTreeNode {
  return {
    id: 1,
    displayName: 'Ada Lovelace',
    role: 'MANAGER',
    jobTitle: 'Engineer',
    department: 'R&D',
    managerId: null,
    isActive: true,
    ...extra,
  }
}

// OrgNode reads only `data`; narrow the type to that so the test needn't build
// a full NodeProps object.
const NodeUnderTest = OrgNode as unknown as FC<{ data: OrgNodeData }>

function data(over: Partial<OrgNodeData> = {}): OrgNodeData {
  return {
    node: node(),
    directReportCount: 0,
    isCollapsed: false,
    hiddenCount: 0,
    isRoot: false,
    isSelf: false,
    ...over,
  }
}

function renderNode(over: Partial<OrgNodeData> = {}) {
  return render(<NodeUnderTest data={data(over)} />)
}

describe('OrgNode', () => {
  it('renders name, job title, department and a role pill', () => {
    renderNode({ directReportCount: 3 })
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Engineer')).toBeInTheDocument()
    expect(screen.getByText('R&D')).toBeInTheDocument()
    expect(screen.getByText('Manager')).toBeInTheDocument()
    expect(screen.getByTestId('org-node-1')).toHaveAttribute('data-role', 'MANAGER')
  })

  it('shows the direct-report count on an expanded toggle', () => {
    renderNode({ directReportCount: 3 })
    const toggle = screen.getByRole('button', { name: 'Hide 3 reports' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('3')
  })

  it('singularizes a single report', () => {
    renderNode({ directReportCount: 1 })
    expect(screen.getByRole('button', { name: 'Hide 1 report' })).toBeInTheDocument()
  })

  it('shows how many people a collapsed node hides', () => {
    renderNode({ directReportCount: 2, isCollapsed: true, hiddenCount: 6 })
    const toggle = screen.getByRole('button', { name: 'Show 2 reports' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('+6')
  })

  it('has no toggle when there are no reports', () => {
    renderNode({ node: node({ jobTitle: null, department: null }) })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('toggles through the chart context without bubbling to the card click', async () => {
    const user = userEvent.setup()
    const toggleCollapse = jest.fn()
    const onCardClick = jest.fn()
    render(
      <OrgChartActionsContext.Provider value={{ toggleCollapse }}>
        {/* Stands in for React Flow's node wrapper, which owns the click that
            opens the detail modal. */}
        <div onClick={onCardClick}>
          <NodeUnderTest data={data({ directReportCount: 2 })} />
        </div>
      </OrgChartActionsContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Hide 2 reports' }))
    expect(toggleCollapse).toHaveBeenCalledWith(1)
    expect(onCardClick).not.toHaveBeenCalled()
  })

  it('rings and labels the self node and dims an inactive one', () => {
    renderNode({ node: node({ isActive: false }), isRoot: true, isSelf: true })
    const card = screen.getByTestId('org-node-1')
    expect(card.className).toContain('ring-2')
    expect(card.className).toContain('opacity-60')
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('marks a forest root without the self treatment', () => {
    renderNode({ isRoot: true })
    const card = screen.getByTestId('org-node-1')
    expect(card).toHaveAttribute('data-root', 'true')
    expect(card.className).not.toContain('ring-2')
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('renders every card at the same fixed size, with or without a job title', () => {
    renderNode({ node: node({ jobTitle: null, department: null }) })
    const card = screen.getByTestId('org-node-1')
    expect(card.className).toContain('h-[92px]')
    expect(card.className).toContain('w-[272px]')
  })

  it('exposes full text via title attributes (truncation fallback)', () => {
    renderNode()
    expect(screen.getByText('Ada Lovelace')).toHaveAttribute('title', 'Ada Lovelace')
    expect(screen.getByText('Engineer')).toHaveAttribute('title', 'Engineer')
    expect(screen.getByText('R&D')).toHaveAttribute('title', 'R&D')
  })
})
