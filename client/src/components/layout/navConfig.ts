import { LayoutDashboard, ReceiptText, CheckSquare, Users2, ShieldCheck, Settings } from 'lucide-react'
import { Role } from '@/types'
import { cn } from '@/lib/utils'

export interface NavItem {
  to: string
  label: string
  testId: string
  icon: typeof LayoutDashboard
  roles: Role[]
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', testId: 'nav-dashboard', icon: LayoutDashboard, roles: [Role.EMPLOYEE, Role.MANAGER, Role.ADMIN] },
  { to: '/expenses/new', label: 'New expense', testId: 'nav-file-entry', icon: ReceiptText, roles: [Role.EMPLOYEE] },
  { to: '/approvals', label: 'Approvals', testId: 'nav-approvals', icon: CheckSquare, roles: [Role.MANAGER, Role.ADMIN] },
  { to: '/manager/employees', label: 'Team', testId: 'nav-reports', icon: Users2, roles: [Role.MANAGER] },
  { to: '/admin', label: 'Admin', testId: 'nav-registry', icon: ShieldCheck, roles: [Role.ADMIN] },
  { to: '/settings', label: 'Settings', testId: 'nav-settings', icon: Settings, roles: [Role.EMPLOYEE, Role.MANAGER, Role.ADMIN] },
]

export const navItemsForRole = (role: Role) => NAV_ITEMS.filter((i) => i.roles.includes(role))

/**
 * Shared nav-row styling for the desktop sidebar and the mobile sheet so the
 * active/hover treatment stays identical. Active = subtle tinted surface with a
 * left accent rail (via `before:`), never a solid fill.
 */
export const navItemClass = (active: boolean) =>
  cn(
    'group/nav relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
    'before:absolute before:left-0 before:top-1/2 before:h-5 before:-translate-y-1/2 before:w-0.5 before:rounded-full before:bg-primary before:transition-opacity',
    active
      ? 'bg-sidebar-accent text-foreground font-medium before:opacity-100'
      : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground before:opacity-0'
  )
