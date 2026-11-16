import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ReactFlow,
  Background,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize,
  Minus,
  Network,
  Plus,
  RefreshCw,
} from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import EmptyState from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useTheme } from '@/lib/theme'
import { useOrgTree } from '@/queries/org'
import type { OrgTree } from '@/types'
import { OrgChartActionsContext } from './org-chart/context'
import { buildOrgGraph, NODE_HEIGHT, NODE_WIDTH, type OrgNodeData } from './org-chart/layout'
import OrgNode from './org-chart/OrgNode'
import OrgNodeDetailDialog from './org-chart/OrgNodeDetailDialog'
import OrgSearch from './org-chart/OrgSearch'
import { roleOrder, roleStyle } from './org-chart/roles'
import { ancestorIds, indexOrgTree, orgStats, type OrgIndex } from './org-chart/tree'

const EMPTY_TREE: OrgTree = { scope: 'ADMIN', rootIds: [], truncated: false, syncedAt: null, nodes: [] }
const NO_COLLAPSED: ReadonlySet<number> = new Set()
// Largest zoom an automatic fit may pick, so a small tree renders at natural
// card size instead of ballooning to 2x.
const FIT_MAX_ZOOM = 1.2

// Compact "synced 5m ago" style label for the freshness floor. Kept tiny and
// local — the codebase has no relative-time helper to reuse.
function formatAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'recently'
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// Visually-hidden, nested-list mirror of the chart. The React Flow canvas conveys
// the reporting structure only visually; this gives screen-reader users the same
// hierarchy, with list nesting standing in for org depth. Cycle-safe via `seen`.
function OrgOutline({ tree, index }: { tree: OrgTree; index: OrgIndex }) {
  const { byId, childrenOf } = index

  const seen = new Set<number>()
  const renderLevel = (ids: number[]): ReactElement => (
    <ul>
      {ids.map((id) => {
        const n = byId.get(id)
        if (!n || seen.has(id)) return null
        seen.add(id)
        const meta = [n.role, n.jobTitle, n.department].filter(Boolean).join(', ')
        const kids = childrenOf.get(id) ?? []
        return (
          <li key={id}>
            {n.displayName}
            {meta && ` — ${meta}`}
            {kids.length > 0 && renderLevel(kids)}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="sr-only">
      <h2>Reporting hierarchy</h2>
      {renderLevel(tree.rootIds)}
    </div>
  )
}

// One "7 people" figure in the summary strip.
function Stat({ value, one, many }: { value: number; one: string; many: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dd className="font-semibold text-foreground tabular-nums">{value}</dd>
      <dt>{value === 1 ? one : many}</dt>
    </div>
  )
}

function CanvasButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 cursor-pointer items-center justify-center text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground [&_svg]:size-4"
    >
      {children}
    </button>
  )
}

export default function OrgChart() {
  const { theme } = useTheme()
  const { data, isPending, isError, isFetching, refetch } = useOrgTree()

  const index = useMemo(() => indexOrgTree(data ?? EMPTY_TREE), [data])
  const stats = useMemo(() => orgStats(index), [index])

  // Ids whose reports are folded away.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(NO_COLLAPSED)
  const graph = useMemo(
    () => (data ? buildOrgGraph(data, collapsed) : { nodes: [], edges: [] }),
    [data, collapsed],
  )
  // OrgNode is typed on the concrete OrgFlowNode; cast once here to satisfy
  // NodeTypes' default-NodeProps signature (the usual custom-node variance).
  const nodeTypes = useMemo(() => ({ orgNode: OrgNode }) as unknown as NodeTypes, [])

  // The live canvas (null until React Flow has mounted) — drives zoom, fit and
  // centring from the toolbar and search.
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null)

  // A viewport adjustment to apply once the next layout lands: keep a toggled
  // card under the cursor (`anchor`), or re-fit after a bulk expand/collapse.
  const pendingView = useRef<{ anchor?: { id: string; x: number; y: number }; fit?: boolean } | null>(
    null,
  )

  const toggleCollapse = useCallback(
    (id: number) => {
      const at = flow?.getNode(String(id))?.position
      pendingView.current = at ? { anchor: { id: String(id), x: at.x, y: at.y } } : null
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (!next.delete(id)) next.add(id)
        return next
      })
    },
    [flow],
  )
  const actions = useMemo(() => ({ toggleCollapse }), [toggleCollapse])

  // Managers below the top level — what "Collapse all" folds, leaving each root
  // and its direct reports on screen.
  const foldable = useMemo(() => {
    const roots = new Set(data?.rootIds ?? [])
    return [...index.childrenOf.keys()].filter((id) => !roots.has(id))
  }, [index, data])
  const anyCollapsed = [...collapsed].some((id) => index.childrenOf.has(id))
  const toggleAll = () => {
    pendingView.current = { fit: true }
    setCollapsed(anyCollapsed ? NO_COLLAPSED : new Set(foldable))
  }

  // The person jumped to from search: revealed, centred and briefly pulsed.
  const [focus, setFocus] = useState<{ id: number } | null>(null)
  const centred = useRef<{ id: number } | null>(null)
  const focusPerson = useCallback(
    (id: number) => {
      const above = ancestorIds(index, id)
      pendingView.current = null
      setCollapsed((prev) => {
        if (!above.some((a) => prev.has(a))) return prev
        const next = new Set(prev)
        for (const a of above) next.delete(a)
        return next
      })
      setFocus({ id })
    },
    [index],
  )

  // Apply the pending viewport change against the freshly laid-out graph.
  useEffect(() => {
    if (!flow) return

    const pending = pendingView.current
    pendingView.current = null
    if (pending?.fit) {
      void flow.fitView({ maxZoom: FIT_MAX_ZOOM, duration: 300 })
    } else if (pending?.anchor) {
      const now = graph.nodes.find((n) => n.id === pending.anchor!.id)?.position
      if (now) {
        const { x, y, zoom } = flow.getViewport()
        void flow.setViewport({
          x: x - (now.x - pending.anchor.x) * zoom,
          y: y - (now.y - pending.anchor.y) * zoom,
          zoom,
        })
      }
    }

    if (focus && centred.current !== focus) {
      const target = graph.nodes.find((n) => n.id === String(focus.id))
      if (target) {
        centred.current = focus
        void flow.setCenter(target.position.x + NODE_WIDTH / 2, target.position.y + NODE_HEIGHT / 2, {
          zoom: 1,
          duration: 500,
        })
      }
    }
  }, [flow, graph, focus])

  useEffect(() => {
    if (!focus) return
    const timer = setTimeout(() => setFocus(null), 2600)
    return () => clearTimeout(timer)
  }, [focus])

  // Hovering a card lights up its reporting line up to the root.
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const trail = useMemo(
    () => (hoveredId == null ? null : new Set([hoveredId, ...ancestorIds(index, hoveredId)])),
    [index, hoveredId],
  )
  // Only the affected nodes/edges get a new object, so the rest keep their
  // identity and don't re-render.
  const nodes = useMemo(
    () =>
      graph.nodes.map((n) => {
        const id = Number(n.id)
        const className = cn(trail?.has(id) && 'org-on-path', focus?.id === id && 'org-focused')
        return className ? { ...n, className } : n
      }),
    [graph.nodes, trail, focus],
  )
  const edges = useMemo(
    () =>
      trail
        ? graph.edges.map((e) =>
            trail.has(Number(e.source)) && trail.has(Number(e.target))
              ? { ...e, className: 'org-edge-active', zIndex: 1 }
              : e,
          )
        : graph.edges,
    [graph.edges, trail],
  )
  const onNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => setHoveredId(Number(node.id)), [])
  const onNodeMouseLeave = useCallback(() => setHoveredId(null), [])

  // The node whose detail modal is open (captured from the click — carries the
  // report count already computed for the chart). null = modal closed.
  const [selected, setSelected] = useState<OrgNodeData | null>(null)
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => setSelected(node.data as unknown as OrgNodeData),
    [],
  )

  // Resolve the selected node's manager name from the tree the client already has,
  // so the modal shows it without the endpoint re-sending structural data.
  const selectedManagerName =
    selected?.node.managerId != null
      ? index.byId.get(selected.node.managerId)?.displayName ?? null
      : null

  const description = data
    ? data.scope === 'ADMIN'
      ? 'Everyone across the organization, laid out by reporting line.'
      : 'You and everyone who reports up to you.'
    : "Your organization's reporting hierarchy."

  return (
    <div className="space-y-6">
      <PageHeader
        title="Org Chart"
        description={description}
        actions={
          <div className="flex items-center gap-3">
            {data?.syncedAt && (
              <span className="text-xs text-muted-foreground">Synced {formatAgo(data.syncedAt)}</span>
            )}
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={cn('mr-2 size-4', isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        }
      />

      {isError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&rsquo;t load the org chart. Please try again.
        </p>
      ) : isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading org chart&hellip;</span>
          <Skeleton className="h-[520px] w-full rounded-lg" />
        </div>
      ) : graph.nodes.length === 0 ? (
        <EmptyState
          icon={<Network />}
          title="No org data yet"
          description="Once reporting lines are synced from the directory, your organization chart will appear here."
        />
      ) : (
        <div className="space-y-3">
          {data?.truncated && (
            <p className="rounded-md bg-muted px-4 py-2 text-xs text-muted-foreground">
              This view was capped for size &mdash; some people may be hidden.
            </p>
          )}
          <OrgOutline tree={data} index={index} />
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-3 py-2.5">
              <OrgSearch index={index} onSelect={focusPerson} />
              <dl
                aria-label="Organization summary"
                className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
              >
                <Stat value={stats.people} one="person" many="people" />
                <Stat value={stats.managers} one="manager" many="managers" />
                <Stat value={stats.departments} one="department" many="departments" />
                <Stat value={stats.levels} one="level" many="levels" />
              </dl>
              {foldable.length > 0 && (
                <Button variant="ghost" size="sm" onClick={toggleAll} className="ml-auto text-muted-foreground">
                  {anyCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
                  {anyCollapsed ? 'Expand all' : 'Collapse all'}
                </Button>
              )}
            </div>
            <div
              data-testid="org-chart-canvas"
              aria-label="Organization reporting hierarchy diagram"
              className="org-flow relative h-[calc(100vh-19.5rem)] min-h-[520px] w-full overflow-hidden rounded-b-xl bg-background"
            >
              <OrgChartActionsContext.Provider value={actions}>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  colorMode={theme}
                  onInit={setFlow}
                  fitView
                  fitViewOptions={{ maxZoom: FIT_MAX_ZOOM }}
                  minZoom={0.2}
                  // Only mount nodes/edges in the viewport — keeps a large org
                  // (up to the MAX_ORG_NODES cap) responsive to pan/zoom.
                  onlyRenderVisibleElements
                  onNodeClick={onNodeClick}
                  onNodeMouseEnter={onNodeMouseEnter}
                  onNodeMouseLeave={onNodeMouseLeave}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  edgesFocusable={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={22} size={1.25} color="var(--org-dot)" bgColor="transparent" />
                </ReactFlow>
              </OrgChartActionsContext.Provider>

              <div
                role="group"
                aria-label="Chart zoom"
                className="absolute bottom-3 left-3 z-10 flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-md"
              >
                <CanvasButton label="Zoom in" onClick={() => void flow?.zoomIn({ duration: 200 })}>
                  <Plus />
                </CanvasButton>
                <CanvasButton label="Zoom out" onClick={() => void flow?.zoomOut({ duration: 200 })}>
                  <Minus />
                </CanvasButton>
                <CanvasButton
                  label="Fit to screen"
                  onClick={() => void flow?.fitView({ maxZoom: FIT_MAX_ZOOM, duration: 300 })}
                >
                  <Maximize />
                </CanvasButton>
              </div>

              <ul
                aria-label="Role legend"
                className="absolute right-3 bottom-3 z-10 hidden items-center gap-3.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground shadow-md sm:flex"
              >
                {roleOrder.map((role) => (
                  <li key={role} className="flex items-center gap-1.5">
                    <span aria-hidden className={cn('size-2 rounded-full', roleStyle[role].dot)} />
                    {roleStyle[role].label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <OrgNodeDetailDialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        node={selected?.node ?? null}
        managerName={selectedManagerName}
        directReportCount={selected?.directReportCount}
      />
    </div>
  )
}
