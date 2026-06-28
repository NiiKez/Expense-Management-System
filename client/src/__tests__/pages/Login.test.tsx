import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders, makeMockAuthValue } from '../helpers/renderWithProviders'
import { STUB_USERS } from '../../context/stubUsers'

// Login branches on IS_STUB_AUTH_MODE — a module-eval constant in services/env that
// is true only for a non-prod localhost stub build. Mock the module behind a getter
// so a single `mockStubAuthMode` flag flips it per test, exercising both the
// stub-user-list branch and the Microsoft-login-button branch.
let mockStubAuthMode = true
let mockDemoEnabled = false
jest.mock('../../services/env', () => ({
  __esModule: true,
  get IS_STUB_AUTH_MODE() {
    return mockStubAuthMode
  },
  get IS_DEMO_ENABLED() {
    return mockDemoEnabled
  },
}))

// Factory-mock AuthContext (rather than automock) so the real provider — and its
// transitive MSAL/api imports — never load; we only need a controllable useAuth.
jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuth: jest.fn(),
}))

// Login imports the axios client directly (for demo-login). Mock it so the
// transitive MSAL import (which needs WebCrypto, absent in jsdom) never loads.
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn().mockResolvedValue({ data: { data: { token: 'demo-token' } } }) },
}))

import { useAuth } from '../../context/AuthContext'
import api from '../../services/api'
import Login from '../../pages/Login'

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>
const mockApiPost = api.post as jest.Mock

const DEMO_ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE'] as const

function setAuth(overrides: Parameters<typeof makeMockAuthValue>[0] = {}) {
  const value = makeMockAuthValue(overrides)
  mockUseAuth.mockReturnValue(value)
  return value
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStubAuthMode = true
  mockDemoEnabled = false
})

describe('Login', () => {
  describe('isLoading state', () => {
    it('renders only the loading spinner, no sign-in UI, while auth resolves', () => {
      setAuth({ isLoading: true })

      const { container } = renderWithProviders(<Login />)

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
      expect(screen.queryByTestId('nav-signin')).not.toBeInTheDocument()
      expect(screen.queryByTestId('msal-login')).not.toBeInTheDocument()
    })
  })

  describe('already authenticated', () => {
    it('redirects to "/" instead of rendering the sign-in screen', () => {
      setAuth({ isAuthenticated: true })

      renderWithProviders(
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Home Page</div>} />
        </Routes>,
        { initialEntries: ['/login'] },
      )

      expect(screen.getByText('Home Page')).toBeInTheDocument()
      expect(screen.queryByTestId('nav-signin')).not.toBeInTheDocument()
    })
  })

  describe('stub auth mode', () => {
    it('lists every stub user as a selectable account', () => {
      setAuth()

      renderWithProviders(<Login />)

      expect(
        screen.getByText('Development mode — select an account to continue.'),
      ).toBeInTheDocument()
      for (const u of STUB_USERS) {
        expect(screen.getByTestId(`stub-login-${u.id}`)).toBeInTheDocument()
      }
      // No Microsoft button in stub mode.
      expect(screen.queryByTestId('msal-login')).not.toBeInTheDocument()
    })

    it('dispatches login(user) with the chosen stub account on click', async () => {
      const user = userEvent.setup()
      const auth = setAuth()

      renderWithProviders(<Login />)

      await user.click(screen.getByTestId(`stub-login-${STUB_USERS[0]!.id}`))

      expect(auth.login).toHaveBeenCalledTimes(1)
      expect(auth.login).toHaveBeenCalledWith(STUB_USERS[0])
    })
  })

  describe('MSAL (production) mode', () => {
    it('renders the Microsoft sign-in button instead of the stub list', () => {
      mockStubAuthMode = false
      setAuth()

      renderWithProviders(<Login />)

      expect(
        screen.getByText('Use your organization account to continue.'),
      ).toBeInTheDocument()
      expect(screen.getByTestId('msal-login')).toBeInTheDocument()
      expect(screen.queryByTestId(`stub-login-${STUB_USERS[0]!.id}`)).not.toBeInTheDocument()
    })

    it('dispatches login() with no argument when the Microsoft button is clicked', async () => {
      const user = userEvent.setup()
      mockStubAuthMode = false
      const auth = setAuth()

      renderWithProviders(<Login />)

      await user.click(screen.getByTestId('msal-login'))

      expect(auth.login).toHaveBeenCalledTimes(1)
      expect(auth.login).toHaveBeenCalledWith()
    })

    it('shows a demo role picker (one card per role) only when demo mode is enabled', () => {
      mockStubAuthMode = false
      mockDemoEnabled = true
      setAuth()

      renderWithProviders(<Login />)

      for (const role of DEMO_ROLES) {
        expect(screen.getByTestId(`demo-login-${role}`)).toBeInTheDocument()
      }
      // The Microsoft sign-in button stays above the picker.
      expect(screen.getByTestId('msal-login')).toBeInTheDocument()
    })

    it('hides the demo picker when demo mode is disabled', () => {
      mockStubAuthMode = false
      mockDemoEnabled = false
      setAuth()

      renderWithProviders(<Login />)

      for (const role of DEMO_ROLES) {
        expect(screen.queryByTestId(`demo-login-${role}`)).not.toBeInTheDocument()
      }
    })

    it('POSTs /auth/demo-login with the chosen role when a demo card is clicked', async () => {
      const user = userEvent.setup()
      mockStubAuthMode = false
      mockDemoEnabled = true
      setAuth()

      // On success the handler calls window.location.assign('/'). jsdom's location
      // is locked (non-configurable getter, read-only assign) so it can't be
      // spied; the real call just logs a benign "Not implemented: navigation".
      // Silence that one line and assert the request contract + resulting state.
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      renderWithProviders(<Login />)

      const card = screen.getByTestId('demo-login-MANAGER')
      await user.click(card)

      expect(mockApiPost).toHaveBeenCalledTimes(1)
      expect(mockApiPost).toHaveBeenCalledWith('/auth/demo-login', { role: 'MANAGER' })
      // The picker stays locked (pending) once a session is being minted.
      await waitFor(() => expect(card).toBeDisabled())

      errSpy.mockRestore()
    })
  })
})
