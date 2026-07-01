import { buildOrgGraph } from '@/pages/org-chart/layout'
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
})
