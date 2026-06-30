import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { IS_DEMO_ENABLED, IS_STUB_AUTH_MODE } from '../services/env'
import { STUB_USERS } from '../context/stubUsers'
import api from '../services/api'
import { storeDemoToken } from '../services/demoAuth'
import { Role } from '../types'
import type { User } from '../types'
import { Button } from '../components/ui/button'
import AccountPicker, { type AccountPickerItem } from '../components/auth/AccountPicker'
import Logo from '../components/layout/Logo'

// The three personas a public demo visitor can step into. The `key` doubles as
// the role sent to the server and as the pending-spinner match in AccountPicker.
const DEMO_ACCOUNTS: AccountPickerItem[] = [
  { key: Role.ADMIN, name: 'Demo Admin', subtitle: 'Full system access', role: Role.ADMIN, testId: 'demo-login-ADMIN' },
  { key: Role.MANAGER, name: 'Demo User', subtitle: 'Approves team expenses', role: Role.MANAGER, testId: 'demo-login-MANAGER' },
  { key: Role.EMPLOYEE, name: 'Jordan Lee', subtitle: 'Submits expenses', role: Role.EMPLOYEE, testId: 'demo-login-EMPLOYEE' },
]

export default function Login() {
  const { isAuthenticated, isLoading, login } = useAuth()
  const [demoPending, setDemoPending] = useState<Role | null>(null)
  const [demoError, setDemoError] = useState<string | null>(null)

  const handleDemoLogin = async (role: Role) => {
    setDemoError(null)
    setDemoPending(role)
    try {
      const res = await api.post<{ data: { token: string } }>('/auth/demo-login', { role })
      storeDemoToken(res.data.data.token)
      // Full navigation so AuthProvider re-evaluates and mounts the demo session.
      window.location.assign('/')
    } catch {
      setDemoError('Could not start the demo right now. Please try again.')
      setDemoPending(null)
    }
  }

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
                  : IS_DEMO_ENABLED
                    ? 'Explore the live demo — pick a role to tour the app. No account needed.'
                    : 'Use your organization account to continue.'}
              </p>
            </div>

            {IS_STUB_AUTH_MODE ? (
              <AccountPicker
                accounts={STUB_USERS.map((u) => ({
                  key: String(u.id),
                  name: u.display_name,
                  subtitle: u.email,
                  role: u.role,
                  testId: `stub-login-${u.id}`,
                }))}
                onSelect={(account) => {
                  const user = STUB_USERS.find((u) => String(u.id) === account.key)
                  if (user) handleStubLogin(user)
                }}
              />
            ) : IS_DEMO_ENABLED ? (
              // Public demo: the persona picker is the primary path (it works for
              // any visitor). Microsoft sign-in is single-tenant and only the
              // project owner's org can pass it, so it's demoted to a secondary,
              // clearly-labeled option below the divider.
              <div className="space-y-5">
                <AccountPicker
                  accounts={DEMO_ACCOUNTS}
                  onSelect={(account) => handleDemoLogin(account.role)}
                  pendingKey={demoPending}
                />

                {demoError && (
                  <p className="text-center text-xs text-destructive">{demoError}</p>
                )}

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Project owner / staff
                  </p>
                  <Button
                    type="button"
                    data-testid="msal-login"
                    variant="outline"
                    className="w-full"
                    onClick={() => login()}
                  >
                    Sign in with Microsoft
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Restricted to the project owner's organization.
                  </p>
                </div>
              </div>
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
