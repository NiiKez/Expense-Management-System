import React from 'react';
import { renderHook, act } from '@testing-library/react';
import type { User } from '../../types';
import { Role } from '../../types';

// Prevent MSAL from initialising a real PublicClientApplication
jest.mock('../../services/auth', () => ({
  msalInstance: { getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}));

// Prevent MSAL React hooks from running (used only in MsalAuthProvider)
jest.mock('@azure/msal-react', () => ({
  useMsal: () => ({ instance: { loginRedirect: jest.fn(), logoutRedirect: jest.fn() } }),
  useIsAuthenticated: () => false,
}));

// Prevent real HTTP calls from api.ts interceptor setup
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), interceptors: { request: { use: jest.fn() } } },
}));

// Import after mocks are registered
import { AuthProvider, useAuth } from '../../context/AuthContext';

// ── Helpers ────────────────────────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    entra_id: 'oid-test',
    email: 'alice@example.com',
    display_name: 'Alice',
    role: Role.EMPLOYEE,
    manager_id: null,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

// ── Tests (VITE_AUTH_MODE=stub set in setupTests.ts) ───────────────

describe('AuthContext — StubAuthProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('initial state', () => {
    it('starts with no user and not authenticated', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('login', () => {
    it('sets the user and marks authenticated after login', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      const user = makeUser();

      await act(async () => {
        await result.current.login(user);
      });

      expect(result.current.user?.id).toBe(user.id);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('does nothing when called without a stub user argument', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.login();
      });

      expect(result.current.user).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears the user and marks not authenticated', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      const user = makeUser();

      await act(async () => {
        await result.current.login(user);
      });

      act(() => {
        result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('sessionStorage persistence', () => {
    it('persists only the stub user id to sessionStorage on login', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      const user = makeUser();

      await act(async () => {
        await result.current.login(user);
      });

      const stored = sessionStorage.getItem('stub_user_id');
      expect(stored).not.toBeNull();
      expect(stored).toBe(String(user.id));
      expect(sessionStorage.getItem('stub_user')).toBeNull();
    });

    it('removes user from sessionStorage on logout', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.login(makeUser());
      });

      act(() => {
        result.current.logout();
      });

      expect(sessionStorage.getItem('stub_user_id')).toBeNull();
      expect(sessionStorage.getItem('stub_user')).toBeNull();
    });

    it('restores user from sessionStorage on mount', async () => {
      const user = makeUser({ id: 7, display_name: 'Restored User' });
      sessionStorage.setItem('stub_user_id', String(user.id));

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user?.id).toBe(user.id);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('ignores unknown stored stub user ids', async () => {
      sessionStorage.setItem('stub_user_id', '999');

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('migrates valid legacy stub user objects to id-only storage', async () => {
      const user = makeUser({ id: 7, display_name: 'Tampered Name', role: Role.ADMIN });
      sessionStorage.setItem('stub_user', JSON.stringify(user));

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user?.id).toBe(user.id);
      expect(result.current.user?.display_name).toBe('Grace Employee');
      expect(sessionStorage.getItem('stub_user_id')).toBe(String(user.id));
      expect(sessionStorage.getItem('stub_user')).toBeNull();
    });
  });
});
