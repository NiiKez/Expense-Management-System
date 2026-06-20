import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Menu, Plus, Settings } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import MobileNav from './MobileNav'
import ThemeToggle from './ThemeToggle'
import NotificationBell from './NotificationBell'

interface TopbarProps {
  title?: string
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export default function Topbar({ title }: TopbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, logout } = useAuth()

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
        {/* Hamburger — mobile only */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="size-[18px]" />
        </Button>

        {/* Subtle context label — pages own their real <h1>. */}
        {title && (
          <span className="truncate text-sm text-muted-foreground">{title}</span>
        )}

        <span className="flex-1" />

        {/* Global action */}
        <Button asChild size="sm" data-testid="topbar-new-expense">
          <Link to="/expenses/new">
            <Plus className="size-4" />
            <span className="hidden sm:inline">New expense</span>
          </Link>
        </Button>

        {/* In-app notifications */}
        {user && <NotificationBell />}

        {/* Theme toggle — always visible for quick access */}
        <ThemeToggle />

        {/* User menu */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Open user menu"
                className="rounded-full outline-none ring-ring/60 ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2"
              >
                <Avatar>
                  <AvatarFallback>{initials(user.display_name)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="flex flex-col gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {user.display_name}
                </span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {user.email}
                </span>
                <Badge
                  variant="secondary"
                  className="mt-0.5 w-fit text-[10px] uppercase tracking-wide"
                >
                  {user.role}
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings" data-testid="menu-settings">
                  <Settings className="size-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className="justify-between"
              >
                <span>Theme</span>
                <ThemeToggle />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => logout()}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {/* Mobile drawer — closed by default, Sheet content not mounted until open */}
      <div className="md:hidden">
        <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} />
      </div>
    </>
  )
}
