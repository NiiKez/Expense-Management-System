import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OrgTree } from '@/types'

// Radix's Dialog (the node-detail modal) uses pointer-capture + scrollIntoView
// APIs jsdom lacks; stub them so opening the modal doesn't throw. Scoped here.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

// Stub React Flow — its canvas needs ResizeObserver (absent in jsdom). We keep
// the `reactflow` chrome marker and additionally render one clickable button per
// node wired to `onNodeClick`, so the node-click → detail-modal flow is testable.
jest.mock('@xyflow/react', () => ({
  ReactFlow: ({
    children,
    nodes,
    onNodeClick,
  }: {
    children?: React.ReactNode
    nodes?: Array<{ id: string; data: { node?: { displayName?: string } } }>
    onNodeClick?: (e: unknown, node: { id: string; data: unknown }) => void
  }) => (
    <div data-testid="reactflow">
      {(nodes ?? []).map((n) => (
        <button
          key={n.id}
          type="button"
          data-testid={`rf-node-${n.id}`}
          onClick={(e) => onNodeClick?.(e, n)}
        >
          {n.data?.node?.displayName}
        </button>
      ))}
      {children}
    </div>
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

import { useOrgTree, useOrgUser } from '@/queries/org'
import OrgChart from '@/pages/OrgChart'

const mockedUseOrgTree = useOrgTree as jest.Mock
const mockedUseOrgUser = useOrgUser as jest.Mock

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

// A manager (root) with one direct report — exercises the report-count wiring
// and the nested outline mirror.
const twoNodes = (): OrgTree => ({
  scope: 'ADMIN',
  rootIds: [1],
  truncated: false,
  syncedAt: '2024-01-01T00:00:00Z',
  nodes: [
    { id: 1, displayName: 'Root Person', role: 'ADMIN', jobTitle: 'CEO', department: 'Exec', managerId: null, isActive: true },
    { id: 2, displayName: 'Report Person', role: 'EMPLOYEE', jobTitle: 'Engineer', department: 'Eng', managerId: 1, isActive: true },
  ],
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

  it('opens the node-detail modal (with resolved details) when a node is clicked', async () => {
    const user = userEvent.setup()
    mockedUseOrgTree.mockReturnValue(hookState({ data: twoNodes() }))
    // The modal fetches per-node detail via useOrgUser — return a resolved
    // payload so the field grid (not the loading skeleton) renders.
    mockedUseOrgUser.mockReturnValue({
      data: {
        id: 1,
        displayName: 'Root Person',
        role: 'ADMIN',
        jobTitle: 'CEO',
        department: 'Exec',
        email: 'root@example.com',
        officeLocation: null,
        employeeId: null,
        mobilePhone: null,
        businessPhones: [],
        isActive: true,
        groups: [],
        source: 'directory',
      },
      isPending: false,
      isError: false,
    })

    render(<OrgChart />)

    // Click the root node (its data carries directReportCount = 1 from buildOrgGraph).
    await user.click(screen.getByTestId('rf-node-1'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Root Person')).toBeInTheDocument()
    expect(within(dialog).getByText('root@example.com')).toBeInTheDocument()
    // The direct-report count computed for the chart flows into the modal.
    expect(within(dialog).getByText('Direct reports')).toBeInTheDocument()
    expect(within(dialog).getByText('1')).toBeInTheDocument()
  })

  it('renders an sr-only outline mirror of the reporting hierarchy', () => {
    mockedUseOrgTree.mockReturnValue(hookState({ data: twoNodes() }))
    render(<OrgChart />)

    const heading = screen.getByRole('heading', { name: 'Reporting hierarchy' })
    const outline = heading.parentElement as HTMLElement
    expect(outline).toHaveClass('sr-only')
    // Each entry carries the person's name plus role/title/department metadata,
    // with the report nested under its manager.
    expect(within(outline).getByText('Root Person — ADMIN, CEO, Exec')).toBeInTheDocument()
    expect(within(outline).getByText('Report Person — EMPLOYEE, Engineer, Eng')).toBeInTheDocument()
  })
})
