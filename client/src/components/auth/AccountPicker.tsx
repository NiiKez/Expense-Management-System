import { ChevronRight, Loader2 } from 'lucide-react'
import type { Role } from '../../types'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Badge } from '../ui/badge'

/** A single selectable account row (a stub user or a demo role). */
export interface AccountPickerItem {
  /** Stable identity used for the React key and the pending/loading match. */
  key: string
  name: string
  subtitle: string
  role: Role
  testId: string
  disabled?: boolean
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const ROLE_BADGE: Record<Role, 'info' | 'secondary' | 'outline'> = {
  ADMIN: 'info',
  MANAGER: 'secondary',
  EMPLOYEE: 'outline',
}

interface AccountPickerProps {
  accounts: AccountPickerItem[]
  onSelect: (account: AccountPickerItem) => void
  /** Key of the account whose request is in flight — shows a spinner and locks the list. */
  pendingKey?: string | null
}

/**
 * Presentational account list shared by the dev stub-auth picker and the public
 * demo role picker. Renders each account as an Avatar + name/subtitle + role
 * Badge + chevron button; swaps the chevron for a spinner on the pending row.
 */
export default function AccountPicker({ accounts, onSelect, pendingKey = null }: AccountPickerProps) {
  const anyPending = pendingKey != null

  return (
    <ul className="space-y-2">
      {accounts.map((account) => {
        const isPending = pendingKey === account.key
        const isDisabled = account.disabled || anyPending

        return (
          <li key={account.key}>
            <button
              type="button"
              data-testid={account.testId}
              onClick={() => onSelect(account)}
              disabled={isDisabled}
              className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
            >
              <Avatar size="sm">
                <AvatarFallback>{initials(account.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {account.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {account.subtitle}
                </span>
              </span>
              <Badge variant={ROLE_BADGE[account.role]} className="shrink-0 text-[10px] uppercase tracking-wide">
                {account.role}
              </Badge>
              {isPending ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
