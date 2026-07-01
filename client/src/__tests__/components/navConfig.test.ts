import { Role } from '@/types'
import { navItemsForRole, NAV_ITEMS } from '@/components/layout/navConfig'

// Expected nav entries per role — the source of truth for who sees what, in the
// order navItemsForRole yields them. A regression that leaks a privileged link
// (e.g. Admin → employee) or drops one must break the exact-set assertion below.
const EXPECTED: Record<Role, Array<{ testId: string; to: string }>> = {
  [Role.EMPLOYEE]: [
    { testId: 'nav-dashboard', to: '/' },
    { testId: 'nav-expenses', to: '/expenses' },
    { testId: 'nav-file-entry', to: '/expenses/new' },
    { testId: 'nav-settings', to: '/settings' },
  ],
  [Role.MANAGER]: [
    { testId: 'nav-dashboard', to: '/' },
    { testId: 'nav-expenses', to: '/expenses' },
    { testId: 'nav-approvals', to: '/approvals' },
    { testId: 'nav-reports', to: '/manager/employees' },
    { testId: 'nav-org-chart', to: '/org-chart' },
    { testId: 'nav-settings', to: '/settings' },
  ],
  [Role.ADMIN]: [
    { testId: 'nav-dashboard', to: '/' },
    { testId: 'nav-expenses', to: '/expenses' },
    { testId: 'nav-approvals', to: '/approvals' },
    { testId: 'nav-org-chart', to: '/org-chart' },
    { testId: 'nav-registry', to: '/admin' },
    { testId: 'nav-settings', to: '/settings' },
  ],
}

describe('navItemsForRole', () => {
  it.each(Object.keys(EXPECTED) as Role[])(
    'returns the exact ordered link set for %s',
    (role) => {
      const items = navItemsForRole(role)
      const expected = EXPECTED[role]
      expect(items.map((i) => i.testId)).toEqual(expected.map((e) => e.testId))
      // hrefs match too, so a link can't silently point at the wrong route.
      items.forEach((item, idx) => expect(item.to).toBe(expected[idx]?.to))
      // Every returned item genuinely lists the role — no accidental over-grant.
      items.forEach((item) => expect(item.roles).toContain(role))
    },
  )

  it('never leaks the Admin registry or manager links to an employee', () => {
    const ids = navItemsForRole(Role.EMPLOYEE).map((i) => i.testId)
    expect(ids).not.toContain('nav-registry')
    expect(ids).not.toContain('nav-approvals')
    expect(ids).not.toContain('nav-org-chart')
    expect(ids).not.toContain('nav-reports')
  })

  it('gives the employee-only "New expense" entry to no other role', () => {
    expect(navItemsForRole(Role.EMPLOYEE).map((i) => i.testId)).toContain('nav-file-entry')
    expect(navItemsForRole(Role.MANAGER).map((i) => i.testId)).not.toContain('nav-file-entry')
    expect(navItemsForRole(Role.ADMIN).map((i) => i.testId)).not.toContain('nav-file-entry')
  })

  it('scopes the admin registry to ADMIN only', () => {
    expect(navItemsForRole(Role.ADMIN).map((i) => i.testId)).toContain('nav-registry')
    expect(navItemsForRole(Role.MANAGER).map((i) => i.testId)).not.toContain('nav-registry')
  })

  it('exposes the full catalogue without filtering by role', () => {
    // Sanity: the filter operates over the whole table, so a new item is picked up.
    expect(NAV_ITEMS.length).toBe(8)
  })
})
