import { act, render, screen, within } from '@testing-library/react'
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

// The fake canvas instance the React Flow stub hands to `onInit`, so the page's
// zoom / fit / centring calls are observable.
const mockFlow = {
  zoomIn: jest.fn(),
  zoomOut: jest.fn(),
  fitView: jest.fn(),
  setCenter: jest.fn(),
  setViewport: jest.fn(),
  getViewport: jest.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  getNode: jest.fn((id: string) => ({ id, position: { x: 0, y: 0 } })),
}

// Stub React Flow — its canvas needs ResizeObserver (absent in jsdom). We keep
// the `reactflow` chrome marker and render, per node, a clickable button wired
// to `onNodeClick` / the hover handlers plus a collapse toggle wired to the
// chart's actions context, so the page's interactions are testable. Edges are
// listed as markers carrying their class.
jest.mock('@xyflow/react', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const { OrgChartActionsContext } = jest.requireActual<
    typeof import('@/pages/org-chart/context')
  >('@/pages/org-chart/context')

  type StubNode = { id: string; className?: string; data: { node?: { displayName?: string } } }
  type StubEdge = { id: string; className?: string }

  function ReactFlow({
    children,
    nodes,
    edges,
    onInit,
    onNodeClick,
    onNodeMouseEnter,
    onNodeMouseLeave,
  }: {
    children?: React.ReactNode
    nodes?: StubNode[]
    edges?: StubEdge[]
    onInit?: (instance: unknown) => void
    onNodeClick?: (e: unknown, node: StubNode) => void
    onNodeMouseEnter?: (e: unknown, node: StubNode) => void
    onNodeMouseLeave?: (e: unknown, node: StubNode) => void
  }) {
    const { toggleCollapse } = React.useContext(OrgChartActionsContext)
    React.useEffect(() => {
      onInit?.(mockFlow)
    }, [onInit])
    return (
      <div data-testid="reactflow">
        {(nodes ?? []).map((n) => (
          <div key={n.id}>
            <button
              type="button"
              data-testid={`rf-node-${n.id}`}
              className={n.className}
              onClick={(e) => onNodeClick?.(e, n)}
              onMouseEnter={(e) => onNodeMouseEnter?.(e, n)}
              onMouseLeave={(e) => onNodeMouseLeave?.(e, n)}
            >
              {n.data?.node?.displayName}
            </button>
            <button
              type="button"
              data-testid={`rf-toggle-${n.id}`}
              onClick={() => toggleCollapse(Number(n.id))}
            />
          </div>
        ))}
        {(edges ?? []).map((e) => (
          <span key={e.id} data-testid={`rf-edge-${e.id}`} className={e.className} />
        ))}
        {children}
      </div>
    )
  }

  return {
    ReactFlow,
    Background: () => null,
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom' },
  }
})
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

  describe('toolbar and canvas interactions', () => {
    // 1 → (2 → (4 → 5), 3): two levels of management under the root.
    const deep = (): OrgTree => ({
      scope: 'ADMIN',
      rootIds: [1],
      truncated: false,
      syncedAt: '2024-01-01T00:00:00Z',
      nodes: [
        { id: 1, displayName: 'Root Person', role: 'ADMIN', jobTitle: 'CEO', department: 'Exec', managerId: null, isActive: true },
        { id: 2, displayName: 'Mid Manager', role: 'MANAGER', jobTitle: 'Head of Eng', department: 'Eng', managerId: 1, isActive: true },
        { id: 3, displayName: 'Solo Report', role: 'EMPLOYEE', jobTitle: null, department: 'Exec', managerId: 1, isActive: true },
        { id: 4, displayName: 'Team Lead', role: 'MANAGER', jobTitle: 'Lead', department: 'Eng', managerId: 2, isActive: true },
        { id: 5, displayName: 'Deep Report', role: 'EMPLOYEE', jobTitle: 'Engineer', department: 'Eng', managerId: 4, isActive: true },
      ],
    })

    function renderDeep() {
      mockedUseOrgTree.mockReturnValue(hookState({ data: deep() }))
      const user = userEvent.setup()
      render(<OrgChart />)
      return user
    }

    it('summarizes the organization and lists the role legend', () => {
      renderDeep()
      const summary = screen.getByLabelText('Organization summary')
      expect(summary).toHaveTextContent('5people')
      expect(summary).toHaveTextContent('3managers')
      expect(summary).toHaveTextContent('2departments')
      expect(summary).toHaveTextContent('4levels')

      const legend = screen.getByRole('list', { name: 'Role legend' })
      expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Admin',
        'Manager',
        'Employee',
      ])
    })

    it('singularizes summary figures', () => {
      mockedUseOrgTree.mockReturnValue(hookState({ data: oneNode() }))
      render(<OrgChart />)
      const summary = screen.getByLabelText('Organization summary')
      expect(summary).toHaveTextContent('1person')
      expect(summary).toHaveTextContent('1level')
      // Nothing below the top level to fold, so no bulk toggle.
      expect(screen.queryByRole('button', { name: /Collapse all|Expand all/ })).not.toBeInTheDocument()
    })

    it('folds and unfolds one manager from the card toggle, keeping the card in place', async () => {
      const user = renderDeep()
      mockFlow.getNode.mockReturnValueOnce({ id: '2', position: { x: 500, y: 500 } })

      await user.click(screen.getByTestId('rf-toggle-2'))
      expect(screen.queryByTestId('rf-node-4')).not.toBeInTheDocument()
      expect(screen.queryByTestId('rf-node-5')).not.toBeInTheDocument()
      expect(screen.getByTestId('rf-node-3')).toBeInTheDocument()
      // The viewport is shifted by however far the layout moved the toggled card.
      expect(mockFlow.setViewport).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()

      await user.click(screen.getByTestId('rf-toggle-2'))
      expect(screen.getByTestId('rf-node-5')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument()
    })

    it('collapses everything below the top level, then expands it again, re-fitting each time', async () => {
      const user = renderDeep()

      await user.click(screen.getByRole('button', { name: 'Collapse all' }))
      expect(screen.getByTestId('rf-node-1')).toBeInTheDocument()
      expect(screen.getByTestId('rf-node-2')).toBeInTheDocument()
      expect(screen.getByTestId('rf-node-3')).toBeInTheDocument()
      expect(screen.queryByTestId('rf-node-4')).not.toBeInTheDocument()
      expect(mockFlow.fitView).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'Expand all' }))
      expect(screen.getByTestId('rf-node-5')).toBeInTheDocument()
      expect(mockFlow.fitView).toHaveBeenCalledTimes(2)
    })

    it('reveals, centres and highlights a person picked from search', async () => {
      const user = renderDeep()
      await user.click(screen.getByRole('button', { name: 'Collapse all' }))
      expect(screen.queryByTestId('rf-node-5')).not.toBeInTheDocument()

      await user.type(screen.getByRole('combobox', { name: 'Find a person' }), 'deep')
      await user.click(screen.getByRole('option', { name: /Deep Report/ }))

      // Their collapsed managers are unfolded so the card exists again.
      expect(screen.getByTestId('rf-node-5')).toHaveClass('org-focused')
      expect(mockFlow.setCenter).toHaveBeenCalledTimes(1)
      expect(mockFlow.setCenter.mock.calls[0]![2]).toMatchObject({ zoom: 1 })
    })

    it('clears the search highlight after a moment', async () => {
      jest.useFakeTimers()
      try {
        mockedUseOrgTree.mockReturnValue(hookState({ data: deep() }))
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
        render(<OrgChart />)

        await user.type(screen.getByRole('combobox', { name: 'Find a person' }), 'solo')
        await user.keyboard('{Enter}')
        expect(screen.getByTestId('rf-node-3')).toHaveClass('org-focused')

        act(() => {
          jest.advanceTimersByTime(3000)
        })
        expect(screen.getByTestId('rf-node-3')).not.toHaveClass('org-focused')
      } finally {
        jest.useRealTimers()
      }
    })

    it('lights up the reporting line of a hovered person, up to the root', async () => {
      const user = renderDeep()

      await user.hover(screen.getByTestId('rf-node-4'))
      for (const id of [4, 2, 1]) expect(screen.getByTestId(`rf-node-${id}`)).toHaveClass('org-on-path')
      for (const id of [3, 5]) expect(screen.getByTestId(`rf-node-${id}`)).not.toHaveClass('org-on-path')
      expect(screen.getByTestId('rf-edge-e-1-2')).toHaveClass('org-edge-active')
      expect(screen.getByTestId('rf-edge-e-2-4')).toHaveClass('org-edge-active')
      expect(screen.getByTestId('rf-edge-e-1-3')).not.toHaveClass('org-edge-active')
      expect(screen.getByTestId('rf-edge-e-4-5')).not.toHaveClass('org-edge-active')

      await user.unhover(screen.getByTestId('rf-node-4'))
      expect(screen.getByTestId('rf-node-4')).not.toHaveClass('org-on-path')
      expect(screen.getByTestId('rf-edge-e-1-2')).not.toHaveClass('org-edge-active')
    })

    it('drives zoom and fit from the canvas controls', async () => {
      const user = renderDeep()
      const zoom = screen.getByRole('group', { name: 'Chart zoom' })

      await user.click(within(zoom).getByRole('button', { name: 'Zoom in' }))
      await user.click(within(zoom).getByRole('button', { name: 'Zoom out' }))
      await user.click(within(zoom).getByRole('button', { name: 'Fit to screen' }))

      expect(mockFlow.zoomIn).toHaveBeenCalledTimes(1)
      expect(mockFlow.zoomOut).toHaveBeenCalledTimes(1)
      expect(mockFlow.fitView).toHaveBeenCalledTimes(1)
    })
  })
})
