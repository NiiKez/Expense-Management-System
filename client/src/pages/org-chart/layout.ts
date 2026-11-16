import * as dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'
import type { OrgTree, OrgTreeNode } from '@/types'
import { descendantIds, indexOrgTree } from './tree'

// Rendered node box size — shared with the dagre layout so edges land on the
// card. OrgNode renders at exactly this size (every card is the same height
// whether or not it has a job title), so rows stay level.
export const NODE_WIDTH = 272
export const NODE_HEIGHT = 92

// Data carried on each React Flow node. Extends Record<string, unknown> to
// satisfy React Flow's Node<T> constraint.
export interface OrgNodeData extends Record<string, unknown> {
  node: OrgTreeNode
  // Direct reports WITHIN the returned set (a leaf clipped by the depth cap
  // reads 0 — the tree's `truncated` flag communicates that clipping).
  directReportCount: number
  // The subtree below this node is folded away; `hiddenCount` is how many people
  // (at any depth) that hides.
  isCollapsed: boolean
  hiddenCount: number
  // A (forest) root: no manager, or a manager outside the returned set.
  isRoot: boolean
  // The caller's own node (MANAGER scope only) — highlighted as "you".
  isSelf: boolean
}

export type OrgFlowNode = Node<OrgNodeData, 'orgNode'>
// A smoothstep edge; `pathOptions` rounds the elbows of the connector.
export type OrgFlowEdge = Edge & { pathOptions?: { borderRadius?: number } }

/**
 * Turn the flat `/org/tree` payload into positioned React Flow nodes + edges.
 *
 * Pure and framework-free (only dagre + types), so it unit-tests without jsdom.
 * The tree is threaded from `managerId`: an edge runs managerId → id when both
 * ends are in the returned set. Nodes are deduped by id first, because a cycle
 * in cached manager_id data can surface the same node twice from the backend CTE.
 *
 * `collapsed` holds the ids whose subtree is folded away: everyone below them is
 * left out of the layout, and the collapsed node carries how many people it hides.
 */
export function buildOrgGraph(
  tree: OrgTree,
  collapsed: ReadonlySet<number> = new Set(),
): { nodes: OrgFlowNode[]; edges: OrgFlowEdge[] } {
  // Deduped nodes + direct reports present in the returned set. The index skips
  // a self-referential row (managerId === id, only possible from corrupt cached
  // data), so a node never counts or links to itself.
  const { byId, childrenOf } = indexOrgTree(tree)

  const rootSet = new Set(tree.rootIds)
  const selfId = tree.scope === 'MANAGER' ? tree.rootIds[0] : undefined

  // Everyone under a collapsed node drops out of the layout.
  const hidden = new Set<number>()
  const hiddenCount = new Map<number, number>()
  for (const id of collapsed) {
    if (!childrenOf.has(id)) continue
    const below = descendantIds({ byId, childrenOf }, id)
    hiddenCount.set(id, below.length)
    for (const d of below) hidden.add(d)
  }
  const visible = [...byId.values()].filter((n) => !hidden.has(n.id))

  // Lay out top-down with dagre.
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 84, marginx: 32, marginy: 32 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of visible) {
    g.setNode(String(n.id), { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  const edges: OrgFlowEdge[] = []
  for (const [managerId, reportIds] of childrenOf) {
    if (hidden.has(managerId) || hiddenCount.has(managerId)) continue
    for (const id of reportIds) {
      g.setEdge(String(managerId), String(id))
      edges.push({
        id: `e-${managerId}-${id}`,
        source: String(managerId),
        target: String(id),
        type: 'smoothstep',
        pathOptions: { borderRadius: 12 },
        selectable: false,
        focusable: false,
      })
    }
  }

  dagre.layout(g)

  const nodes: OrgFlowNode[] = visible.map((n) => {
    const laid = g.node(String(n.id))
    // dagre positions from the node centre; React Flow wants the top-left corner.
    const x = (laid?.x ?? 0) - NODE_WIDTH / 2
    const y = (laid?.y ?? 0) - NODE_HEIGHT / 2
    return {
      id: String(n.id),
      type: 'orgNode',
      position: { x, y },
      // Cards are a fixed size, so state it up front. Without this React Flow
      // treats every replaced node object (e.g. one gaining a highlight class)
      // as unmeasured: it hides the card and drops its connectors until a
      // re-measure, which under the cursor flickers in a hover loop.
      measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
      data: {
        node: n,
        directReportCount: childrenOf.get(n.id)?.length ?? 0,
        isCollapsed: hiddenCount.has(n.id),
        hiddenCount: hiddenCount.get(n.id) ?? 0,
        isRoot: rootSet.has(n.id),
        isSelf: n.id === selfId,
      },
    }
  })

  return { nodes, edges }
}
