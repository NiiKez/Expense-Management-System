import { NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { navItemsForRole, navItemClass } from './navConfig'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'

interface MobileNavProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export default function MobileNav({ open, onOpenChange }: MobileNavProps) {
  const { user, logout } = useAuth()

  if (!user) return null

  const items = navItemsForRole(user.role)

  const close = () => onOpenChange(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-0" showCloseButton>
        <SheetHeader className="h-16 justify-center border-b border-sidebar-border px-4">
          <SheetTitle className="text-left">
            <Logo />
          </SheetTitle>
        </SheetHeader>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => (
            <NavLink
              key={item.testId}
              to={item.to}
              end={item.to === '/'}
              data-testid={item.testId}
              onClick={close}
              className={({ isActive }) => navItemClass(isActive)}
            >
              <item.icon className="size-[18px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
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
            <ThemeToggle />
          </div>
          <Button
            type="button"
            data-testid="nav-signout"
            variant="ghost"
            onClick={() => {
              logout()
              close()
            }}
            className={cn(
              'mt-1 w-full justify-start gap-3 px-2 font-normal text-sidebar-foreground',
              'hover:bg-sidebar-accent/60 hover:text-foreground'
            )}
          >
            <LogOut className="size-[18px] shrink-0" />
            Sign out
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
