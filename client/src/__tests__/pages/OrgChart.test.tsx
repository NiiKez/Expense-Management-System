import { render, screen } from '@testing-library/react'
import type { OrgTree } from '@/types'

// Stub React Flow — its canvas needs ResizeObserver (absent in jsdom). We assert
// the page's states/chrome, not React Flow's internal rendering.
jest.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="reactflow">{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))
// Factory mock so the real module graph (services/api → MSAL) never loads.
// useOrgUser is stubbed too — the (closed) detail dialog is always mounted and
// calls it, so it must exist even though these tests never open the modal.
jest.mock('@/queries/org', () => ({
  useOrgTree: jest.fn(),
  useOrgUser: jest.fn(() => ({ data: undefined, isPending: false, isError: false })),
  orgKeys: { all: ['org'], tree: () => ['org', 'tree'], user: (id: number) => ['org', 'user', id] },
}))

import { useOrgTree } from '@/queries/org'
import OrgChart from '@/pages/OrgChart'

const mockedUseOrgTree = useOrgTree as jest.Mock

function hookState(over: Record<string, unknown>) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
    ...over,
  }
}

const oneNode = (over: Partial<OrgTree> = {}): OrgTree => ({
  scope: 'ADMIN',
  rootIds: [1],
  truncated: false,
  syncedAt: '2024-01-01T00:00:00Z',
  nodes: [
    {
      id: 1,
      displayName: 'Root Person',
      role: 'ADMIN',
      jobTitle: null,
      department: null,
      managerId: null,
      isActive: true,
    },
  ],
  ...over,
})

beforeEach(() => jest.clearAllMocks())

describe('OrgChart page', () => {
  it('shows a loading skeleton while pending', () => {
    mockedUseOrgTree.mockReturnValue(hookState({ isPending: true }))
    render(<OrgChart />)
    expect(screen.getByText(/Loading org chart/i)).toBeInTheDocument()
  })

  it('shows an error message on failure', () => {
    mockedUseOrgTree.mockReturnValue(hookState({ isError: true }))
    render(<OrgChart />)
    expect(screen.getByText(/Couldn.t load the org chart/i)).toBeInTheDocument()
  })

  it('shows the empty state (with the manager blurb) when there are no nodes', () => {
    mockedUseOrgTree.mockReturnValue(
      hookState({ data: { scope: 'MANAGER', rootIds: [], truncated: false, syncedAt: null, nodes: [] } }),
    )
    render(<OrgChart />)
    expect(screen.getByText(/No org data yet/i)).toBeInTheDocument()
    expect(screen.getByText(/reports up to you/i)).toBeInTheDocument()
  })

  it('renders the chart, admin blurb, synced label and truncation notice', () => {
    mockedUseOrgTree.mockReturnValue(hookState({ data: oneNode({ truncated: true }) }))
    render(<OrgChart />)
    expect(screen.getByTestId('reactflow')).toBeInTheDocument()
    expect(screen.getByText(/Everyone across the organization/i)).toBeInTheDocument()
    expect(screen.getByText(/Synced/i)).toBeInTheDocument()
    expect(screen.getByText(/capped for size/i)).toBeInTheDocument()
  })
})
