import { buildOrgGraph, NODE_HEIGHT } from '@/pages/org-chart/layout'
import type { OrgTree, OrgTreeNode } from '@/types'

function node(id: number, managerId: number | null, extra: Partial<OrgTreeNode> = {}): OrgTreeNode {
  return {
    id,
    managerId,
    displayName: `User ${id}`,
    role: 'EMPLOYEE',
    jobTitle: null,
    department: null,
    isActive: true,
    ...extra,
  }
}

function tree(nodes: OrgTreeNode[], over: Partial<OrgTree> = {}): OrgTree {
  return { scope: 'MANAGER', rootIds: [1], truncated: false, syncedAt: null, nodes, ...over }
}

describe('buildOrgGraph', () => {
  it('threads edges from manager to report and positions every node', () => {
    const { nodes, edges } = buildOrgGraph(
      tree([node(1, null, { role: 'MANAGER' }), node(2, 1), node(3, 1)]),
    )
    expect(nodes).toHaveLength(3)
    expect(edges.map((e) => e.id).sort()).toEqual(['e-1-2', 'e-1-3'])
    expect(edges.every((e) => e.source === '1')).toBe(true)
    for (const n of nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true)
      expect(Number.isFinite(n.position.y)).toBe(true)
    }
  })

  it('dedupes a node that appears twice (cycle in cached manager_id)', () => {
    const { nodes } = buildOrgGraph(tree([node(1, null), node(2, 1), node(2, 1)]))
    expect(nodes).toHaveLength(2)
  })

  it('counts only direct reports present in the returned set', () => {
    const { nodes } = buildOrgGraph(tree([node(1, null), node(2, 1), node(3, 1), node(4, 2)]))
    const counts = Object.fromEntries(nodes.map((n) => [n.id, n.data.directReportCount]))
    expect(counts['1']).toBe(2)
    expect(counts['2']).toBe(1)
    expect(counts['3']).toBe(0)
  })

  it('does not create a dangling edge when the manager is outside the set', () => {
    const { nodes, edges } = buildOrgGraph(
      tree([node(2, 99)], { scope: 'ADMIN', rootIds: [2] }),
    )
    expect(edges).toHaveLength(0)
    expect(nodes[0]!.data.isRoot).toBe(true)
  })

  it('flags the caller node as self for MANAGER scope (rootIds[0])', () => {
    const { nodes } = buildOrgGraph(tree([node(1, null), node(2, 1)]))
    expect(nodes.find((n) => n.id === '1')!.data.isSelf).toBe(true)
    expect(nodes.find((n) => n.id === '2')!.data.isSelf).toBe(false)
  })

  it('never flags a self node for ADMIN scope', () => {
    const { nodes } = buildOrgGraph(tree([node(1, null)], { scope: 'ADMIN', rootIds: [1] }))
    expect(nodes[0]!.data.isSelf).toBe(false)
    expect(nodes[0]!.data.isRoot).toBe(true)
  })

  it('marks every forest root and keeps independent subtrees unlinked (ADMIN)', () => {
    const { nodes, edges } = buildOrgGraph(
      tree(
        [node(1, null, { role: 'ADMIN' }), node(2, 1), node(5, null, { role: 'ADMIN' }), node(6, 5)],
        { scope: 'ADMIN', rootIds: [1, 5] },
      ),
    )
    const isRoot = Object.fromEntries(nodes.map((n) => [n.id, n.data.isRoot]))
    expect(isRoot['1']).toBe(true)
    expect(isRoot['5']).toBe(true)
    expect(isRoot['2']).toBe(false)
    expect(isRoot['6']).toBe(false)
    // The two trees don't cross-link, and ADMIN scope never marks a "self".
    expect(edges.map((e) => e.id).sort()).toEqual(['e-1-2', 'e-5-6'])
    expect(nodes.every((n) => n.data.isSelf === false)).toBe(true)
  })

  it('ignores a self-referential managerId (no self-edge, no self-count)', () => {
    const { nodes, edges } = buildOrgGraph(
      tree([node(1, 1, { role: 'MANAGER' })], { scope: 'ADMIN', rootIds: [1] }),
    )
    expect(edges).toHaveLength(0)
    expect(nodes[0]!.data.directReportCount).toBe(0)
  })

  it('keeps every row level (same y for all nodes at one depth)', () => {
    const { nodes } = buildOrgGraph(
      tree([node(1, null), node(2, 1, { jobTitle: 'Engineer' }), node(3, 1)]),
    )
    const y = Object.fromEntries(nodes.map((n) => [n.id, n.position.y]))
    expect(y['2']).toBe(y['3'])
    expect(y['2']! - y['1']!).toBeGreaterThan(NODE_HEIGHT)
  })

  describe('collapsed subtrees', () => {
    // 1 → (2 → (4 → 5), 3)
    const nested = () => tree([node(1, null), node(2, 1), node(3, 1), node(4, 2), node(5, 4)])

    it('drops everyone below a collapsed node, at any depth', () => {
      const { nodes, edges } = buildOrgGraph(nested(), new Set([2]))
      expect(nodes.map((n) => n.id).sort()).toEqual(['1', '2', '3'])
      expect(edges.map((e) => e.id).sort()).toEqual(['e-1-2', 'e-1-3'])
    })

    it('flags the collapsed node with how many people it hides', () => {
      const { nodes } = buildOrgGraph(nested(), new Set([2]))
      const two = nodes.find((n) => n.id === '2')!.data
      expect(two.isCollapsed).toBe(true)
      expect(two.hiddenCount).toBe(2)
      // The direct-report count is unchanged by collapsing.
      expect(two.directReportCount).toBe(1)
      const one = nodes.find((n) => n.id === '1')!.data
      expect(one.isCollapsed).toBe(false)
      expect(one.hiddenCount).toBe(0)
    })

    it('ignores a collapsed id that has no reports or is not in the tree', () => {
      const { nodes } = buildOrgGraph(nested(), new Set([3, 99]))
      expect(nodes).toHaveLength(5)
      expect(nodes.every((n) => n.data.isCollapsed === false)).toBe(true)
    })

    it('survives a reporting cycle under a collapsed node', () => {
      // 2 and 3 manage each other; 1 is the only real root.
      const { nodes } = buildOrgGraph(
        tree([node(1, null), node(2, 3), node(3, 2), node(4, 1)]),
        new Set([2]),
      )
      expect(nodes.map((n) => n.id).sort()).toEqual(['1', '2', '4'])
    })
  })
})
