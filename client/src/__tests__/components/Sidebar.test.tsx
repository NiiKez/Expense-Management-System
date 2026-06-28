import React from 'react'
import { render, screen } from '@testing-library/react'
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
