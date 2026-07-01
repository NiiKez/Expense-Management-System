import * as dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'
import type { OrgTree, OrgTreeNode } from '@/types'

// Rendered node box size — shared with the dagre layout so edges land on the
// card, and with OrgNode's width so the two stay in sync.
export const NODE_WIDTH = 240
export const NODE_HEIGHT = 96

// Data carried on each React Flow node. Extends Record<string, unknown> to
// satisfy React Flow's Node<T> constraint.
export interface OrgNodeData extends Record<string, unknown> {
  node: OrgTreeNode
  // Direct reports WITHIN the returned set (a leaf clipped by the depth cap
  // reads 0 — the tree's `truncated` flag communicates that clipping).
  directReportCount: number
  // A (forest) root: no manager, or a manager outside the returned set.
  isRoot: boolean
  // The caller's own node (MANAGER scope only) — highlighted as "you".
  isSelf: boolean
}

export type OrgFlowNode = Node<OrgNodeData, 'orgNode'>
export type OrgFlowEdge = Edge

/**
 * Turn the flat `/org/tree` payload into positioned React Flow nodes + edges.
 *
 * Pure and framework-free (only dagre + types), so it unit-tests without jsdom.
 * The tree is threaded from `managerId`: an edge runs managerId → id when both
 * ends are in the returned set. Nodes are deduped by id first, because a cycle
 * in cached manager_id data can surface the same node twice from the backend CTE.
 */
export function buildOrgGraph(tree: OrgTree): { nodes: OrgFlowNode[]; edges: OrgFlowEdge[] } {
  // Dedupe by id (first occurrence wins — deterministic).
  const byId = new Map<number, OrgTreeNode>()
  for (const n of tree.nodes) {
    if (!byId.has(n.id)) byId.set(n.id, n)
  }
  const unique = [...byId.values()]

  const rootSet = new Set(tree.rootIds)
  const selfId = tree.scope === 'MANAGER' ? tree.rootIds[0] : undefined

  // Count direct reports that are present in the returned set. A self-referential
  // row (managerId === id, only possible from corrupt cached data) is skipped so
  // a node never counts itself as its own report.
  const reportCount = new Map<number, number>()
  for (const n of unique) {
    if (n.managerId != null && n.managerId !== n.id && byId.has(n.managerId)) {
      reportCount.set(n.managerId, (reportCount.get(n.managerId) ?? 0) + 1)
    }
  }

  // Lay out top-down with dagre.
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of unique) {
    g.setNode(String(n.id), { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  const edges: OrgFlowEdge[] = []
  for (const n of unique) {
    // Skip the self-loop a corrupt managerId === id row would otherwise draw.
    if (n.managerId != null && n.managerId !== n.id && byId.has(n.managerId)) {
      g.setEdge(String(n.managerId), String(n.id))
      edges.push({
        id: `e-${n.managerId}-${n.id}`,
        source: String(n.managerId),
        target: String(n.id),
        type: 'smoothstep',
      })
    }
  }

  dagre.layout(g)

  const nodes: OrgFlowNode[] = unique.map((n) => {
    const laid = g.node(String(n.id))
    // dagre positions from the node centre; React Flow wants the top-left corner.
    const x = (laid?.x ?? 0) - NODE_WIDTH / 2
    const y = (laid?.y ?? 0) - NODE_HEIGHT / 2
    return {
      id: String(n.id),
      type: 'orgNode',
      position: { x, y },
      data: {
        node: n,
        directReportCount: reportCount.get(n.id) ?? 0,
        isRoot: rootSet.has(n.id),
        isSelf: n.id === selfId,
      },
    }
  })

  return { nodes, edges }
}
