import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders, makeMockAuthValue } from '../helpers/renderWithProviders'
import { STUB_USERS } from '../../context/stubUsers'

// Login branches on IS_STUB_AUTH_MODE — a module-eval constant in services/env that
// is true only for a non-prod localhost stub build. Mock the module behind a getter
// so a single `mockStubAuthMode` flag flips it per test, exercising both the
// stub-user-list branch and the Microsoft-login-button branch.
let mockStubAuthMode = true
jest.mock('../../services/env', () => ({
  __esModule: true,
  get IS_STUB_AUTH_MODE() {
    return mockStubAuthMode
  },
}))

// Factory-mock AuthContext (rather than automock) so the real provider — and its
// transitive MSAL/api imports — never load; we only need a controllable useAuth.
jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuth: jest.fn(),
}))

import { useAuth } from '../../context/AuthContext'
import Login from '../../pages/Login'

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

function setAuth(overrides: Parameters<typeof makeMockAuthValue>[0] = {}) {
  const value = makeMockAuthValue(overrides)
  mockUseAuth.mockReturnValue(value)
  return value
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStubAuthMode = true
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
  })
})
