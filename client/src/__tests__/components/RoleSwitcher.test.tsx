import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockUser } from '../helpers/factories'
import { makeMockAuthValue } from '../helpers/renderWithProviders'
import { Role } from '../../types'

// Navigation is asserted via a mocked useNavigate; everything else in
// react-router-dom stays real.
const mockNavigate = jest.fn()
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}))

// Factory-mock AuthContext so the real provider (and its MSAL/api imports) never
// load; we only need a controllable useAuth — same pattern as Login.test.
jest.mock('@/context/AuthContext', () => ({
  __esModule: true,
  useAuth: jest.fn(),
}))

import { useAuth } from '@/context/AuthContext'
import RoleSwitcher from '@/components/auth/RoleSwitcher'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

// Radix Dropdown content focus-manages on open; jsdom lacks these DOM APIs.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = jest.fn(() => false)
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = jest.fn()
  }
})

beforeEach(() => jest.clearAllMocks())

// Renders the switcher inside an open menu (RadioItem requires the menu context).
function renderInOpenMenu() {
  return render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <RoleSwitcher />
      </DropdownMenuContent>
    </DropdownMenu>,
  )
}

describe('RoleSwitcher', () => {
  it('renders nothing for a user who holds a single role', () => {
    mockUseAuth.mockReturnValue(
      makeMockAuthValue({ user: mockUser({ role: Role.EMPLOYEE, roles: [Role.EMPLOYEE] }) }),
    )

    renderInOpenMenu()

    expect(screen.queryByTestId('role-switch-EMPLOYEE')).not.toBeInTheDocument()
  })

  it('renders nothing when roles is undefined (pre-fetch / stub user)', () => {
    mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ role: Role.MANAGER }) }))

    renderInOpenMenu()

    expect(screen.queryByTestId('role-switch-MANAGER')).not.toBeInTheDocument()
  })

  it('renders one option per held role with the active one checked', () => {
    mockUseAuth.mockReturnValue(
      makeMockAuthValue({
        user: mockUser({ role: Role.MANAGER, roles: [Role.MANAGER, Role.EMPLOYEE] }),
      }),
    )

    renderInOpenMenu()

    const manager = screen.getByTestId('role-switch-MANAGER')
    const employee = screen.getByTestId('role-switch-EMPLOYEE')
    expect(manager).toBeInTheDocument()
    expect(employee).toBeInTheDocument()
    // The active role is reflected as the checked radio item.
    expect(manager).toHaveAttribute('aria-checked', 'true')
    expect(employee).toHaveAttribute('aria-checked', 'false')
  })

  it('switches role and navigates home when a different role is selected', async () => {
    const user = userEvent.setup()
    const value = makeMockAuthValue({
      user: mockUser({ role: Role.MANAGER, roles: [Role.MANAGER, Role.EMPLOYEE] }),
    })
    mockUseAuth.mockReturnValue(value)

    renderInOpenMenu()

    await user.click(screen.getByTestId('role-switch-EMPLOYEE'))

    expect(value.switchRole).toHaveBeenCalledWith(Role.EMPLOYEE)
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('does nothing when the already-active role is selected', async () => {
    const user = userEvent.setup()
    const value = makeMockAuthValue({
      user: mockUser({ role: Role.MANAGER, roles: [Role.MANAGER, Role.EMPLOYEE] }),
    })
    mockUseAuth.mockReturnValue(value)

    renderInOpenMenu()

    await user.click(screen.getByTestId('role-switch-MANAGER'))

    expect(value.switchRole).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
