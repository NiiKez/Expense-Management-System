import type { OrgTree, OrgTreeNode } from '@/types'

// Lookup structure over the flat `/org/tree` payload, shared by the layout, the
// screen-reader outline, search and the summary strip so they all agree on what
// counts as a reporting line.
export interface OrgIndex {
  // Deduped by id (first occurrence wins — a cycle in cached manager_id data can
  // surface the same node twice from the backend CTE).
  byId: Map<number, OrgTreeNode>
  // Direct reports present in the returned set, in payload order.
  childrenOf: Map<number, number[]>
}

export function indexOrgTree(tree: OrgTree): OrgIndex {
  const byId = new Map<number, OrgTreeNode>()
  for (const n of tree.nodes) {
    if (!byId.has(n.id)) byId.set(n.id, n)
  }

  const childrenOf = new Map<number, number[]>()
  for (const n of byId.values()) {
    const managerId = parentId(byId, n)
    if (managerId == null) continue
    const kids = childrenOf.get(managerId) ?? []
    kids.push(n.id)
    childrenOf.set(managerId, kids)
  }

  return { byId, childrenOf }
}

// The node's manager when that manager is in the returned set. A self-referential
// row (managerId === id, only possible from corrupt cached data) has no parent.
function parentId(byId: Map<number, OrgTreeNode>, n: OrgTreeNode): number | null {
  if (n.managerId == null || n.managerId === n.id || !byId.has(n.managerId)) return null
  return n.managerId
}

/** The reporting chain above `id`, nearest manager first. Cycle-safe. */
export function ancestorIds(index: OrgIndex, id: number): number[] {
  const chain: number[] = []
  const seen = new Set<number>([id])
  let current = index.byId.get(id)
  while (current) {
    const managerId = parentId(index.byId, current)
    if (managerId == null || seen.has(managerId)) break
    seen.add(managerId)
    chain.push(managerId)
    current = index.byId.get(managerId)
  }
  return chain
}

/** Everyone below `id` at any depth (excluding `id` itself). Cycle-safe. */
export function descendantIds(index: OrgIndex, id: number): number[] {
  const out: number[] = []
  const seen = new Set<number>([id])
  const stack = [...(index.childrenOf.get(id) ?? [])]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    out.push(next)
    stack.push(...(index.childrenOf.get(next) ?? []))
  }
  return out
}

export interface OrgStats {
  people: number
  managers: number
  departments: number
  levels: number
}

/** Headline numbers for the summary strip above the chart. */
export function orgStats(index: OrgIndex): OrgStats {
  const departments = new Set<string>()
  for (const n of index.byId.values()) {
    const dept = n.department?.trim()
    if (dept) departments.add(dept.toLowerCase())
  }

  // Depth by breadth-first walk from every node with no manager in the set.
  let levels = 0
  const seen = new Set<number>()
  let frontier = [...index.byId.values()]
    .filter((n) => parentId(index.byId, n) == null)
    .map((n) => n.id)
  while (frontier.length > 0) {
    levels += 1
    const next: number[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      next.push(...(index.childrenOf.get(id) ?? []))
    }
    frontier = next.filter((id) => !seen.has(id))
  }

  return {
    people: index.byId.size,
    managers: index.childrenOf.size,
    departments: departments.size,
    levels,
  }
}

/**
 * Case-insensitive person search over name, job title and department. Name
 * matches rank ahead of title/department matches, prefix matches first.
 */
export function searchOrg(index: OrgIndex, query: string, limit = 8): OrgTreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const ranked: { node: OrgTreeNode; rank: number }[] = []
  for (const node of index.byId.values()) {
    const name = node.displayName.toLowerCase()
    let rank: number
    if (name.startsWith(q)) rank = 0
    else if (name.split(/\s+/).some((part) => part.startsWith(q))) rank = 1
    else if (name.includes(q)) rank = 2
    else if (node.jobTitle?.toLowerCase().includes(q)) rank = 3
    else if (node.department?.toLowerCase().includes(q)) rank = 4
    else continue
    ranked.push({ node, rank })
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || a.node.displayName.localeCompare(b.node.displayName))
    .slice(0, limit)
    .map((r) => r.node)
}
