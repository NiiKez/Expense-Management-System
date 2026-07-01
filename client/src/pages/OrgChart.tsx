import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { ReactFlow, Background, Controls, type Node, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Network, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import EmptyState from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useTheme } from '@/lib/theme'
import { useOrgTree } from '@/queries/org'
import type { OrgTree, OrgTreeNode } from '@/types'
import { buildOrgGraph, type OrgNodeData } from './org-chart/layout'
import OrgNode from './org-chart/OrgNode'
import OrgNodeDetailDialog from './org-chart/OrgNodeDetailDialog'

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
function OrgOutline({ tree }: { tree: OrgTree }) {
  const byId = new Map<number, OrgTreeNode>()
  for (const n of tree.nodes) if (!byId.has(n.id)) byId.set(n.id, n)

  const childrenOf = new Map<number, number[]>()
  for (const n of byId.values()) {
    if (n.managerId != null && n.managerId !== n.id && byId.has(n.managerId)) {
      const kids = childrenOf.get(n.managerId) ?? []
      kids.push(n.id)
      childrenOf.set(n.managerId, kids)
    }
  }

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

export default function OrgChart() {
  const { theme } = useTheme()
  const { data, isPending, isError, isFetching, refetch } = useOrgTree()

  const graph = useMemo(
    () => (data ? buildOrgGraph(data) : { nodes: [], edges: [] }),
    [data],
  )
  // OrgNode is typed on the concrete OrgFlowNode; cast once here to satisfy
  // NodeTypes' default-NodeProps signature (the usual custom-node variance).
  const nodeTypes = useMemo(() => ({ orgNode: OrgNode }) as unknown as NodeTypes, [])

  // The node whose detail modal is open (captured from the click — carries the
  // report count already computed for the chart). null = modal closed.
  const [selected, setSelected] = useState<OrgNodeData | null>(null)
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => setSelected(node.data as unknown as OrgNodeData),
    [],
  )

  // Resolve the selected node's manager name from the tree the client already has,
  // so the modal shows it without the endpoint re-sending structural data.
  const nodeById = useMemo(
    () => new Map<number, OrgTreeNode>((data?.nodes ?? []).map((n) => [n.id, n])),
    [data],
  )
  const selectedManagerName =
    selected?.node.managerId != null
      ? nodeById.get(selected.node.managerId)?.displayName ?? null
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
          <OrgOutline tree={data} />
          <div
            data-testid="org-chart-canvas"
            aria-label="Organization reporting hierarchy diagram"
            className="h-[calc(100vh-16rem)] min-h-[520px] w-full overflow-hidden rounded-lg border border-border bg-muted/20"
          >
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              colorMode={theme}
              fitView
              // Cap the auto-fit zoom so a small tree (e.g. a manager with two
              // reports) renders at natural card size instead of ballooning to 2x.
              fitViewOptions={{ maxZoom: 1.2 }}
              minZoom={0.2}
              // Only mount nodes/edges in the viewport — keeps a large org
              // (up to the MAX_ORG_NODES cap) responsive to pan/zoom.
              onlyRenderVisibleElements
              onNodeClick={onNodeClick}
              nodesDraggable={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
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
