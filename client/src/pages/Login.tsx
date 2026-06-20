import { Navigate } from 'react-router-dom'
import { ChevronRight, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { IS_STUB_AUTH_MODE } from '../services/env'
import { STUB_USERS } from '../context/stubUsers'
import type { Role, User } from '../types'
import { Avatar, AvatarFallback } from '../components/ui/avatar'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import Logo from '../components/layout/Logo'

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

export default function Login() {
  const { isAuthenticated, isLoading, login } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background">
        <Logo />
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const handleStubLogin = (user: User) => {
    login(user)
  }

  return (
    <div className="flex min-h-svh bg-background">
      {/* Brand panel — full on lg+, slim header on mobile */}
      <aside className="relative hidden overflow-hidden bg-sidebar lg:flex lg:w-[44%] lg:flex-col lg:justify-between lg:p-12">
        {/* Subtle indigo-violet mesh */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, color-mix(in oklch, var(--primary) 28%, transparent), transparent 45%), radial-gradient(circle at 80% 65%, color-mix(in oklch, var(--accent) 35%, transparent), transparent 50%)',
          }}
        />
        <div className="relative">
          <Logo size={36} />
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
            Expense reporting, finally calm and in control.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Submit, approve, and audit every expense from one streamlined workspace.
          </p>
        </div>
        <p className="relative text-xs text-muted-foreground">
          Encrypted · Audited · Single sign-on
        </p>
      </aside>

      {/* Sign-in column */}
      <main className="flex flex-1 flex-col">
        {/* Mobile slim brand header */}
        <div className="flex h-16 items-center border-b border-border px-6 lg:hidden">
          <Logo />
        </div>

        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-1">
              <Logo className="mb-5 lg:hidden" />
              <h1
                data-testid="nav-signin"
                className="text-2xl font-semibold tracking-tight text-foreground"
              >
                Sign in
              </h1>
              <p className="text-sm text-muted-foreground">
                {IS_STUB_AUTH_MODE
                  ? 'Development mode — select an account to continue.'
                  : 'Use your organization account to continue.'}
              </p>
            </div>

            {IS_STUB_AUTH_MODE ? (
              <ul className="space-y-2">
                {STUB_USERS.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      data-testid={`stub-login-${u.id}`}
                      onClick={() => handleStubLogin(u)}
                      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Avatar size="sm">
                        <AvatarFallback>{initials(u.display_name)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {u.display_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.email}
                        </span>
                      </span>
                      <Badge variant={ROLE_BADGE[u.role]} className="shrink-0 text-[10px] uppercase tracking-wide">
                        {u.role}
                      </Badge>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Button
                type="button"
                data-testid="msal-login"
                className="w-full"
                onClick={() => login()}
              >
                Sign in with Microsoft
              </Button>
            )}

            <p className="text-center text-xs text-muted-foreground lg:hidden">
              Encrypted · Audited · Single sign-on
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
