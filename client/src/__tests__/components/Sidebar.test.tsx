import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from '../../components/layout/Sidebar'
import { Role } from '../../types'
import type { User } from '../../types'

// Prevent PublicClientApplication from being constructed (requires Web Crypto API not in jsdom)
jest.mock('../../services/auth', () => ({
  msalInstance: { getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))

// Mirror server pattern: mock the module, then control return value per test
jest.mock('../../context/AuthContext')

import { useAuth } from '../../context/AuthContext'

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

function makeUser(role: Role): User {
  return {
    id: 1,
    entra_id: 'oid-123',
    email: 'user@example.com',
    display_name: 'Test User',
    role,
    manager_id: null,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

function renderSidebar(role: Role = Role.EMPLOYEE) {
  mockUseAuth.mockReturnValue({
    user: makeUser(role),
    isAuthenticated: true,
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
    switchRole: jest.fn(),
  })

  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )
}

describe('Sidebar user chip', () => {
  it('links the user name/identity chip to settings', () => {
    renderSidebar()

    const name = screen.getByTestId('nav-user-name')
    const link = name.closest('a')

    expect(link).not.toBeNull()
    expect(link).toHaveAttribute('href', '/settings')
  })

  it('gives the user chip link a distinct accessible name', () => {
    renderSidebar()

    const link = screen.getByRole('link', { name: /account settings/i })
    expect(link).toHaveAttribute('href', '/settings')
  })
})

describe('Sidebar navigation', () => {
  it('links to the My expenses list for every role', () => {
    renderSidebar(Role.MANAGER)

    const link = screen.getByTestId('nav-expenses')
    expect(link).toHaveAttribute('href', '/expenses')
  })

  it('does not render a theme toggle (kept in the topbar to avoid duplicates)', () => {
    renderSidebar()

    expect(screen.queryByTestId('theme-toggle')).not.toBeInTheDocument()
  })
})

describe('Sidebar role-based nav', () => {
  it('shows the employee-only "New expense" entry and hides privileged links', () => {
    renderSidebar(Role.EMPLOYEE)

    expect(screen.getByTestId('nav-file-entry')).toHaveAttribute('href', '/expenses/new')
    expect(screen.queryByTestId('nav-approvals')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-org-chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-reports')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-registry')).not.toBeInTheDocument()
  })

  it('shows approvals/org-chart/team for a MANAGER and hides admin + file entry', () => {
    renderSidebar(Role.MANAGER)

    expect(screen.getByTestId('nav-approvals')).toHaveAttribute('href', '/approvals')
    expect(screen.getByTestId('nav-org-chart')).toHaveAttribute('href', '/org-chart')
    expect(screen.getByTestId('nav-reports')).toHaveAttribute('href', '/manager/employees')
    expect(screen.queryByTestId('nav-registry')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-file-entry')).not.toBeInTheDocument()
  })

  it('shows the admin registry for an ADMIN and hides the manager-only Team link', () => {
    renderSidebar(Role.ADMIN)

    expect(screen.getByTestId('nav-registry')).toHaveAttribute('href', '/admin')
    expect(screen.getByTestId('nav-approvals')).toBeInTheDocument()
    expect(screen.getByTestId('nav-org-chart')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-file-entry')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-reports')).not.toBeInTheDocument()
  })
})

describe('Sidebar footer', () => {
  it('calls logout when Sign out is clicked', async () => {
    const logout = jest.fn()
    mockUseAuth.mockReturnValue({
      user: makeUser(Role.EMPLOYEE),
      isAuthenticated: true,
      isLoading: false,
      login: jest.fn(),
      logout,
      switchRole: jest.fn(),
    })

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByTestId('nav-signout'))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when there is no authenticated user', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      login: jest.fn(),
      logout: jest.fn(),
      switchRole: jest.fn(),
    })

    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
