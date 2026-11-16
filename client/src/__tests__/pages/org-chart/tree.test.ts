import {
  ancestorIds,
  descendantIds,
  indexOrgTree,
  orgStats,
  searchOrg,
} from '@/pages/org-chart/tree'
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

function index(nodes: OrgTreeNode[]) {
  const tree: OrgTree = { scope: 'ADMIN', rootIds: [1], truncated: false, syncedAt: null, nodes }
  return indexOrgTree(tree)
}

// 1 → (2 → (4 → 5), 3)
const nested = () => index([node(1, null), node(2, 1), node(3, 1), node(4, 2), node(5, 4)])

describe('indexOrgTree', () => {
  it('dedupes by id and groups direct reports under their manager', () => {
    const idx = index([node(1, null), node(2, 1), node(2, 1), node(3, 1)])
    expect(idx.byId.size).toBe(3)
    expect(idx.childrenOf.get(1)).toEqual([2, 3])
  })

  it('treats a self-managed row or an out-of-set manager as having no parent', () => {
    const idx = index([node(1, 1), node(2, 99)])
    expect(idx.childrenOf.size).toBe(0)
  })
})

describe('ancestorIds', () => {
  it('walks the reporting chain, nearest manager first', () => {
    expect(ancestorIds(nested(), 5)).toEqual([4, 2, 1])
    expect(ancestorIds(nested(), 1)).toEqual([])
  })

  it('returns nothing for an unknown id', () => {
    expect(ancestorIds(nested(), 42)).toEqual([])
  })

  it('terminates on a reporting cycle', () => {
    const idx = index([node(1, 2), node(2, 1)])
    expect(ancestorIds(idx, 1)).toEqual([2])
  })
})

describe('descendantIds', () => {
  it('collects everyone below a node at any depth', () => {
    expect(descendantIds(nested(), 2).sort()).toEqual([4, 5])
    expect(descendantIds(nested(), 1).sort()).toEqual([2, 3, 4, 5])
    expect(descendantIds(nested(), 3)).toEqual([])
  })

  it('terminates on a reporting cycle', () => {
    const idx = index([node(1, 2), node(2, 1)])
    expect(descendantIds(idx, 1)).toEqual([2])
  })
})

describe('orgStats', () => {
  it('counts people, managers, distinct departments and levels', () => {
    const idx = index([
      node(1, null, { department: 'Finance' }),
      node(2, 1, { department: 'Engineering' }),
      node(3, 1, { department: ' engineering ' }),
      node(4, 2),
    ])
    expect(orgStats(idx)).toEqual({ people: 4, managers: 2, departments: 2, levels: 3 })
  })

  it('reports zeroes for an empty tree', () => {
    expect(orgStats(index([]))).toEqual({ people: 0, managers: 0, departments: 0, levels: 0 })
  })

  it('takes the deepest tree in a forest', () => {
    const idx = index([node(1, null), node(5, null), node(6, 5), node(7, 6)])
    expect(orgStats(idx).levels).toBe(3)
  })
})

describe('searchOrg', () => {
  const people = () =>
    index([
      node(1, null, { displayName: 'Alice Admin', jobTitle: 'Chief Administrator', department: 'Finance' }),
      node(2, 1, { displayName: 'Bob Manager', jobTitle: 'Engineering Manager', department: 'Engineering' }),
      node(3, 2, { displayName: 'Dave Employee', jobTitle: 'Software Engineer', department: 'Engineering' }),
      node(4, 2, { displayName: 'Malik Adams', jobTitle: 'Analyst', department: 'Finance' }),
    ])

  it('returns nothing for a blank query', () => {
    expect(searchOrg(people(), '   ')).toEqual([])
  })

  it('matches names case-insensitively, prefix matches first', () => {
    // "a": Alice (name prefix), Malik Adams (word prefix), then substring hits.
    const names = searchOrg(people(), 'A').map((n) => n.displayName)
    expect(names.slice(0, 2)).toEqual(['Alice Admin', 'Malik Adams'])
  })

  it('falls back to job title and department', () => {
    expect(searchOrg(people(), 'analyst').map((n) => n.id)).toEqual([4])
    expect(searchOrg(people(), 'finance').map((n) => n.id).sort()).toEqual([1, 4])
  })

  it('caps the number of results', () => {
    expect(searchOrg(people(), 'e', 2)).toHaveLength(2)
  })

  it('returns nothing when no one matches', () => {
    expect(searchOrg(people(), 'zzz')).toEqual([])
  })
})
