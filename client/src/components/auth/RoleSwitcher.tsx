import { useNavigate } from 'react-router-dom'
import { UserCog } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import type { Role } from '@/types'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
}

/**
 * Lets a user who holds more than one Entra app role pick which one they're
 * acting as. Rendered inside the Topbar user dropdown. Renders NOTHING unless the
 * user holds >1 role, so single-role (and demo/stub) sessions never see it.
 *
 * Switching writes the choice to sessionStorage and refetches /me; the server
 * re-resolves the effective role from the X-Active-Role header (it can only
 * narrow, never escalate), and the whole app follows the refreshed user.role.
 */
export default function RoleSwitcher() {
  const { user, switchRole } = useAuth()
  const navigate = useNavigate()

  if (!user || !user.roles || user.roles.length <= 1) return null

  const handleSwitch = (role: Role) => {
    if (role === user.role) return
    switchRole(role)
    // Send them home so they aren't stranded on a route the new role can't access.
    navigate('/', { replace: true })
  }

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <UserCog className="size-3.5" />
        Acting as
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={user.role}
        onValueChange={(role) => handleSwitch(role as Role)}
      >
        {user.roles.map((role) => (
          <DropdownMenuRadioItem
            key={role}
            value={role}
            data-testid={`role-switch-${role}`}
          >
            {ROLE_LABELS[role]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </>
  )
}
