import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Role } from '../types'

// App wires each sensitive path to the role it demands. To assert that wiring
// without booting the real (heavy) pages, we replace ProtectedRoute with a probe
// that renders its children and surfaces the requiredRole prop it was handed, and
// swap every page for a lightweight marker. This keeps the test about routing +
// authorization, not page internals.
jest.mock('@/components/common/ProtectedRoute', () => ({
  __esModule: true,
  default: ({
    children,
    requiredRole,
  }: {
    children: React.ReactNode
    requiredRole?: unknown
  }) => (
    <div
      data-testid="guard"
      data-required-role={requiredRole === undefined ? 'none' : String(requiredRole)}
    >
      {children}
    </div>
  ),
}))

// AppShell drags in Sidebar/Topbar (auth + notification queries); stub it to a
// pass-through so the page marker still mounts inside it.
jest.mock('@/components/layout/AppShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}))

// Page markers — one per route target. Mapping by resolved module path means
// these replace the same modules App imports (relative or lazy).
const page = (testId: string) => ({
  __esModule: true,
  default: () => <div data-testid={testId} />,
})
jest.mock('@/pages/Login', () => page('page-login'))
jest.mock('@/pages/Dashboard', () => page('page-dashboard'))
jest.mock('@/pages/SubmitExpense', () => page('page-submit'))
jest.mock('@/pages/MyExpenses', () => page('page-expenses'))
jest.mock('@/pages/Approvals', () => page('page-approvals'))
jest.mock('@/pages/Admin', () => page('page-admin'))
jest.mock('@/pages/ManagerEmployees', () => page('page-manager-employees'))
jest.mock('@/pages/Settings', () => page('page-settings'))
jest.mock('@/pages/EditExpense', () => page('page-edit-expense'))
jest.mock('@/pages/OrgChart', () => page('page-org-chart'))
jest.mock('@/components/expenses/ExpenseDetail', () => page('page-expense-detail'))

import App from '../App'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

// path → the requiredRole string the guard must receive. Arrays stringify to a
// comma-joined list (React-Router matches "/expenses/:id/edit" before "/:id").
const GUARDED: Array<[string, string, string]> = [
  ['/', 'none', 'page-dashboard'],
  ['/expenses/new', 'none', 'page-submit'],
  ['/expenses', 'none', 'page-expenses'],
  ['/expenses/7/edit', 'none', 'page-edit-expense'],
  ['/expenses/7', 'none', 'page-expense-detail'],
  ['/approvals', `${Role.MANAGER},${Role.ADMIN}`, 'page-approvals'],
  ['/manager/employees', Role.MANAGER, 'page-manager-employees'],
  ['/org-chart', `${Role.MANAGER},${Role.ADMIN}`, 'page-org-chart'],
  ['/admin', Role.ADMIN, 'page-admin'],
  ['/settings', 'none', 'page-settings'],
]

describe('App route authorization wiring', () => {
  it.each(GUARDED)(
    '%s guards with requiredRole=%s and mounts its page',
    async (path, requiredRole, marker) => {
      renderAt(path)

      // Guard + shell render synchronously even for the lazy org-chart route.
      const guard = screen.getByTestId('guard')
      expect(guard).toHaveAttribute('data-required-role', requiredRole)
      // The correct page mounts inside the guard (findBy covers the lazy import).
      expect(await screen.findByTestId(marker)).toBeInTheDocument()
    },
  )
})

describe('App unguarded routes', () => {
  it('renders /login with no ProtectedRoute guard and no shell', () => {
    renderAt('/login')

    expect(screen.getByTestId('page-login')).toBeInTheDocument()
    expect(screen.queryByTestId('guard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('renders the NotFound catch-all inside the shell but without a guard', () => {
    renderAt('/no-such-route')

    expect(screen.getByText(/404/)).toBeInTheDocument()
    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByTestId('guard')).not.toBeInTheDocument()
  })
})
