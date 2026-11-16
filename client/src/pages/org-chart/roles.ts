import { Role } from '@/types'

// Per-role colour treatment for the org chart (avatar tint, role pill, legend
// swatch). Backed by the `--role-*` tokens in index.css, which are
// tuned per theme so the tinted text stays readable.
export interface RoleStyle {
  label: string
  dot: string
  avatar: string
  badge: string
}

export const roleStyle: Record<Role, RoleStyle> = {
  [Role.ADMIN]: {
    label: 'Admin',
    dot: 'bg-role-admin',
    avatar: 'bg-role-admin/15 text-role-admin',
    badge: 'bg-role-admin/12 text-role-admin',
  },
  [Role.MANAGER]: {
    label: 'Manager',
    dot: 'bg-role-manager',
    avatar: 'bg-role-manager/15 text-role-manager',
    badge: 'bg-role-manager/12 text-role-manager',
  },
  [Role.EMPLOYEE]: {
    label: 'Employee',
    dot: 'bg-role-employee',
    avatar: 'bg-role-employee/15 text-role-employee',
    badge: 'bg-role-employee/12 text-role-employee',
  },
}

// Highest privilege first — the order the legend lists them.
export const roleOrder: Role[] = [Role.ADMIN, Role.MANAGER, Role.EMPLOYEE]
