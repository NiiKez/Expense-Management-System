import { Link, NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { navItemsForRole, navItemClass } from './navConfig'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export default function Sidebar() {
  const { user, logout } = useAuth()

  if (!user) return null

  const items = navItemsForRole(user.role)

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      {/* Brand zone */}
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        <Logo />
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => (
          <NavLink
            key={item.testId}
            to={item.to}
            end={item.to === '/'}
            data-testid={item.testId}
            className={({ isActive }) => navItemClass(isActive)}
          >
            <item.icon className="size-[18px] shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer — user chip + actions */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-1">
          {/* Clicking the identity chip opens settings, mirroring the topbar avatar menu. */}
          <Link
            to="/settings"
            data-testid="nav-user-settings"
            aria-label="Open account settings"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 transition-colors',
              'hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <Avatar size="sm">
              <AvatarFallback>{initials(user.display_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p
                data-testid="nav-user-name"
                className="truncate text-sm font-medium text-sidebar-foreground"
              >
                {user.display_name}
              </p>
              <Badge
                data-testid="nav-user-role"
                variant="secondary"
                className="mt-0.5 text-[10px] uppercase tracking-wide"
              >
                {user.role}
              </Badge>
            </div>
          </Link>
          <ThemeToggle />
        </div>
        <Button
          type="button"
          data-testid="nav-signout"
          variant="ghost"
          onClick={() => logout()}
          className={cn(
            'mt-1 w-full justify-start gap-3 px-2 font-normal text-sidebar-foreground',
            'hover:bg-sidebar-accent/60 hover:text-foreground'
          )}
        >
          <LogOut className="size-[18px] shrink-0" />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
