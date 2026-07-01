import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Role } from '@/types'

// Radix Dialog (Sheet) uses pointer-capture + scrollIntoView APIs jsdom lacks.
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

jest.mock('@/context/AuthContext')

import { useAuth } from '@/context/AuthContext'
import MobileNav from '@/components/layout/MobileNav'
import { makeMockAuthValue } from '../helpers/renderWithProviders'
import { mockUser } from '../helpers/factories'

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

function renderNav(
  role: Role,
  { open = true, onOpenChange = jest.fn(), logout = jest.fn() } = {},
) {
  mockUseAuth.mockReturnValue(
    makeMockAuthValue({ user: mockUser({ role }), isAuthenticated: true, logout }),
  )
  render(
    <MemoryRouter>
      <MobileNav open={open} onOpenChange={onOpenChange} />
    </MemoryRouter>,
  )
  return { onOpenChange, logout }
}

describe('MobileNav role-filtered links', () => {
  it('shows the employee-only entry and hides privileged links for EMPLOYEE', () => {
    renderNav(Role.EMPLOYEE)

    expect(screen.getByTestId('nav-file-entry')).toHaveAttribute('href', '/expenses/new')
    expect(screen.queryByTestId('nav-approvals')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-registry')).not.toBeInTheDocument()
  })

  it('shows approvals, org chart and team for a MANAGER', () => {
    renderNav(Role.MANAGER)

    expect(screen.getByTestId('nav-approvals')).toHaveAttribute('href', '/approvals')
    expect(screen.getByTestId('nav-org-chart')).toHaveAttribute('href', '/org-chart')
    expect(screen.getByTestId('nav-reports')).toHaveAttribute('href', '/manager/employees')
    expect(screen.queryByTestId('nav-registry')).not.toBeInTheDocument()
  })

  it('shows the admin registry for an ADMIN', () => {
    renderNav(Role.ADMIN)

    expect(screen.getByTestId('nav-registry')).toHaveAttribute('href', '/admin')
    expect(screen.queryByTestId('nav-file-entry')).not.toBeInTheDocument()
  })
})

describe('MobileNav actions', () => {
  it('signs out and closes the drawer on Sign out', async () => {
    const { logout, onOpenChange } = renderNav(Role.EMPLOYEE)

    await userEvent.click(screen.getByTestId('nav-signout'))

    expect(logout).toHaveBeenCalledTimes(1)
    // Sign-out also collapses the sheet.
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes the drawer when a nav link is followed', async () => {
    const { onOpenChange } = renderNav(Role.EMPLOYEE)

    await userEvent.click(screen.getByTestId('nav-expenses'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('MobileNav without a user', () => {
  it('renders nothing when there is no authenticated user', () => {
    mockUseAuth.mockReturnValue(makeMockAuthValue({ user: null }))
    const { container } = render(
      <MemoryRouter>
        <MobileNav open onOpenChange={jest.fn()} />
      </MemoryRouter>,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('nav-expenses')).not.toBeInTheDocument()
  })
})
