import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Role } from '@/types'

// Radix DropdownMenu relies on pointer-capture APIs jsdom does not implement.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

// Prevent PublicClientApplication from being constructed (Web Crypto not in jsdom)
jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))

// Isolate Topbar from its query-driven children and the demo-session probe.
jest.mock('@/components/layout/NotificationBell', () => ({
  __esModule: true,
  default: () => <div data-testid="notification-bell" />,
}))
jest.mock('@/components/auth/RoleSwitcher', () => ({
  __esModule: true,
  default: () => <div data-testid="role-switcher" />,
}))
jest.mock('@/components/layout/MobileNav', () => ({
  __esModule: true,
  default: (props: { open: boolean }) => (
    <div data-testid="mobile-nav" data-open={String(props.open)} />
  ),
}))
jest.mock('@/services/demoAuth', () => ({ isDemoSession: jest.fn(() => false) }))

jest.mock('@/context/AuthContext')

import { useAuth } from '@/context/AuthContext'
import { isDemoSession } from '@/services/demoAuth'
import Topbar from '@/components/layout/Topbar'
import { makeMockAuthValue } from '../helpers/renderWithProviders'
import { mockUser } from '../helpers/factories'

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>
const mockIsDemoSession = isDemoSession as jest.MockedFunction<typeof isDemoSession>

function renderTopbar({
  role = Role.MANAGER,
  displayName = 'Grace Hopper',
  logout = jest.fn(),
  user = mockUser({ role, display_name: displayName }) as ReturnType<typeof mockUser> | null,
} = {}) {
  mockUseAuth.mockReturnValue(
    makeMockAuthValue({ user, isAuthenticated: !!user, logout }),
  )
  render(
    <MemoryRouter>
      <Topbar title="Approvals" />
    </MemoryRouter>,
  )
  return { logout }
}

beforeEach(() => {
  mockIsDemoSession.mockReset()
  mockIsDemoSession.mockReturnValue(false)
})

describe('Topbar avatar + user menu', () => {
  it('derives two-letter initials from the display name', async () => {
    renderTopbar({ displayName: 'Grace Hopper' })

    expect(await screen.findByText('GH')).toBeInTheDocument()
  })

  it('opens the user menu and exposes the role badge', async () => {
    renderTopbar({ role: Role.MANAGER })

    await userEvent.click(screen.getByRole('button', { name: 'Open user menu' }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('MANAGER')).toBeInTheDocument()
  })

  it('logs out from the user-menu Sign out item', async () => {
    const { logout } = renderTopbar()

    await userEvent.click(screen.getByRole('button', { name: 'Open user menu' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }))

    expect(logout).toHaveBeenCalledTimes(1)
  })
})

describe('Topbar user-gated chrome', () => {
  it('mounts the NotificationBell and user menu when signed in', () => {
    renderTopbar()

    expect(screen.getByTestId('notification-bell')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open user menu' })).toBeInTheDocument()
  })

  it('hides the bell and user menu when there is no user', () => {
    renderTopbar({ user: null })

    expect(screen.queryByTestId('notification-bell')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open user menu' })).not.toBeInTheDocument()
    // The global "New expense" action is not user-gated, so it stays.
    expect(screen.getByTestId('topbar-new-expense')).toBeInTheDocument()
  })
})

describe('Topbar demo mode', () => {
  it('shows the demo banner and exits the demo on click', async () => {
    mockIsDemoSession.mockReturnValue(true)
    const { logout } = renderTopbar()

    expect(screen.getByText(/Demo mode/)).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('demo-exit'))

    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('omits the demo banner outside a demo session', () => {
    renderTopbar()

    expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('demo-exit')).not.toBeInTheDocument()
  })
})

describe('Topbar mobile drawer', () => {
  it('opens the mobile nav when the hamburger is pressed', async () => {
    renderTopbar()

    expect(screen.getByTestId('mobile-nav')).toHaveAttribute('data-open', 'false')

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    expect(screen.getByTestId('mobile-nav')).toHaveAttribute('data-open', 'true')
  })
})
