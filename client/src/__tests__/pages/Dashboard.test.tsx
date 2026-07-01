import React from 'react'
import { render, screen } from '@testing-library/react'
import { Role } from '@/types'

// The role → dashboard routing is the logic under test; stub the three heavy
// dashboards (each pulls in its own queries) to markers so we can assert which
// one mounts for each role, and that the others do NOT.
jest.mock('@/components/dashboard/EmployeeDashboard', () => ({
  __esModule: true,
  default: () => <div data-testid="employee-dashboard" />,
}))
jest.mock('@/components/dashboard/ManagerDashboard', () => ({
  __esModule: true,
  default: () => <div data-testid="manager-dashboard" />,
}))
jest.mock('@/components/dashboard/AdminDashboard', () => ({
  __esModule: true,
  default: () => <div data-testid="admin-dashboard" />,
}))

// Prevent PublicClientApplication from being constructed (Web Crypto not in jsdom)
jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))

jest.mock('@/context/AuthContext')

import { useAuth } from '@/context/AuthContext'
import Dashboard from '@/pages/Dashboard'
import { makeMockAuthValue } from '../helpers/renderWithProviders'
import { mockUser } from '../helpers/factories'

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

function renderAs(role: Role, displayName = 'Alice Example') {
  mockUseAuth.mockReturnValue(
    makeMockAuthValue({ user: mockUser({ role, display_name: displayName }), isAuthenticated: true }),
  )
  return render(<Dashboard />)
}

describe('Dashboard role routing', () => {
  it('renders only the EmployeeDashboard for an employee', () => {
    renderAs(Role.EMPLOYEE)

    expect(screen.getByTestId('employee-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('manager-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('admin-dashboard')).not.toBeInTheDocument()
  })

  it('renders only the ManagerDashboard for a manager', () => {
    renderAs(Role.MANAGER)

    expect(screen.getByTestId('manager-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('employee-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('admin-dashboard')).not.toBeInTheDocument()
  })

  it('renders only the AdminDashboard for an admin', () => {
    renderAs(Role.ADMIN)

    expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('employee-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manager-dashboard')).not.toBeInTheDocument()
  })
})

describe('Dashboard greeting', () => {
  afterEach(() => jest.restoreAllMocks())

  it('greets by time of day and name (morning branch)', () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9)
    renderAs(Role.EMPLOYEE, 'Grace Hopper')

    expect(screen.getByRole('heading', { name: 'Good morning, Grace Hopper' })).toBeInTheDocument()
  })

  it('greets in the evening after 18:00', () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(21)
    renderAs(Role.EMPLOYEE, 'Grace Hopper')

    expect(screen.getByRole('heading', { name: 'Good evening, Grace Hopper' })).toBeInTheDocument()
  })

  it('falls back to "there" when no display name is available', () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14)
    mockUseAuth.mockReturnValue(makeMockAuthValue({ user: null, isAuthenticated: true }))
    render(<Dashboard />)

    expect(screen.getByRole('heading', { name: 'Good afternoon, there' })).toBeInTheDocument()
  })
})
