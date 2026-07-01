import type { FC } from 'react'
import { render, screen } from '@testing-library/react'
import type { OrgTreeNode } from '@/types'
import type { OrgNodeData } from '@/pages/org-chart/layout'

// React Flow's Handle needs a provider context; stub it (and Position) so the
// node renders standalone in jsdom without a ReactFlowProvider.
jest.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))

import OrgNode from '@/pages/org-chart/OrgNode'

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

function renderNode(data: OrgNodeData) {
  return render(<NodeUnderTest data={data} />)
}

describe('OrgNode', () => {
  it('renders name, subtitle, role badge and report count', () => {
    renderNode({ node: node(), directReportCount: 3, isRoot: true, isSelf: true })
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Engineer · R&D')).toBeInTheDocument()
    expect(screen.getByText('MANAGER')).toBeInTheDocument()
    expect(screen.getByText('3 reports')).toBeInTheDocument()
  })

  it('singularizes a single report', () => {
    renderNode({ node: node(), directReportCount: 1, isRoot: false, isSelf: false })
    expect(screen.getByText('1 report')).toBeInTheDocument()
  })

  it('hides the report count when there are none', () => {
    renderNode({ node: node({ jobTitle: null, department: null }), directReportCount: 0, isRoot: false, isSelf: false })
    expect(screen.queryByText(/report/)).not.toBeInTheDocument()
  })

  it('rings the self node and dims an inactive one', () => {
    renderNode({ node: node({ isActive: false }), directReportCount: 0, isRoot: true, isSelf: true })
    const card = screen.getByTestId('org-node-1')
    expect(card.className).toContain('ring-2')
    expect(card.className).toContain('opacity-60')
  })

  it('rings a non-self forest root more subtly', () => {
    renderNode({ node: node(), directReportCount: 0, isRoot: true, isSelf: false })
    const card = screen.getByTestId('org-node-1')
    expect(card.className).toContain('ring-1')
    expect(card.className).not.toContain('ring-2')
  })

  it('exposes the full subtitle via a title attribute (truncation fallback)', () => {
    renderNode({ node: node({ jobTitle: 'Engineer', department: 'R&D' }), directReportCount: 0, isRoot: false, isSelf: false })
    expect(screen.getByText('Engineer · R&D')).toHaveAttribute('title', 'Engineer · R&D')
  })
})
