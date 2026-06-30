import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '../../types';
import { Role } from '../../types';

// Mutable mock state, flipped per-test. `mock*`-prefixed names are the only outer
// identifiers jest.mock factories may reference (they're hoisted above imports).
// AuthProvider reads IS_STUB_AUTH_MODE at RENDER time, so toggling mockIsStubAuthMode
// before render selects StubAuthProvider (default true, for the suite above) vs
// MsalAuthProvider (false) without re-importing the module or splitting React copies.
let mockIsStubAuthMode = true;
let mockIsAuthenticated = false;
const mockLoginRedirect = jest.fn().mockResolvedValue(undefined);
const mockLogoutRedirect = jest.fn().mockResolvedValue(undefined);
let mockUseMeReturn: { data: User | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

// Prevent MSAL from initialising a real PublicClientApplication
jest.mock('../../services/auth', () => ({
  msalInstance: { getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: ['api://test/access_as_user'] },
}));

// Drive the auth-mode branch in AuthProvider from a mutable flag.
jest.mock('../../services/env', () => ({
  __esModule: true,
  get IS_STUB_AUTH_MODE() {
    return mockIsStubAuthMode;
  },
}));

// MSAL React hooks (used only in MsalAuthProvider) — controllable per test.
jest.mock('@azure/msal-react', () => ({
  useMsal: () => ({ instance: { loginRedirect: mockLoginRedirect, logoutRedirect: mockLogoutRedirect } }),
  useIsAuthenticated: () => mockIsAuthenticated,
}));

// The gated /me query — return controllable success/loading/error states directly,
// so MsalAuthProvider's user/role/isLoading resolution can be asserted in isolation.
jest.mock('../../queries/me', () => ({
  __esModule: true,
  useMe: () => mockUseMeReturn,
  meKeys: { all: ['me'], me: ['me'] },
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

  describe('memoization', () => {
    it('returns a stable context value across re-renders when auth state is unchanged', () => {
      const { result, rerender } = renderHook(() => useAuth(), { wrapper });
      const first = result.current;

      rerender();

      // Memoized provider value: no auth change ⇒ same object identity, so
      // useAuth consumers don't re-render on unrelated provider renders.
      expect(result.current).toBe(first);
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

// ── MsalAuthProvider (production path, IS_STUB_AUTH_MODE forced false) ──
//
// The stub suite above runs with mockIsStubAuthMode=true (the default), so AuthProvider
// picks StubAuthProvider. Here we flip it false so MsalAuthProvider renders, drive
// @azure/msal-react auth state + redirect spies and the gated /me query from the
// mutable mocks, and back useQueryClient with a real QueryClient so logout's
// removeQueries(['me']) can be spied for real. React/react-query stay a single copy
// (no module isolation), avoiding cross-instance "invalid hook call" errors.

describe('AuthContext — MsalAuthProvider', () => {
  let queryClient: QueryClient;
  let removeQueriesSpy: jest.SpyInstance;

  beforeEach(() => {
    sessionStorage.clear();
    mockIsStubAuthMode = false;
    mockIsAuthenticated = false;
    mockUseMeReturn = { data: undefined, isLoading: false, isError: false };
    mockLoginRedirect.mockClear();
    mockLogoutRedirect.mockClear();

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    removeQueriesSpy = jest.spyOn(queryClient, 'removeQueries');
  });

  afterEach(() => {
    // Restore stub mode for any later suites sharing this module instance.
    mockIsStubAuthMode = true;
    removeQueriesSpy.mockRestore();
    queryClient.clear();
  });

  function renderMsalAuth() {
    return renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      ),
    });
  }

  it('exposes the resolved user/role on a successful /me fetch', () => {
    mockIsAuthenticated = true;
    mockUseMeReturn = {
      data: makeUser({ id: 42, display_name: 'Manager Mae', role: Role.MANAGER }),
      isLoading: false,
      isError: false,
    };

    const { result } = renderMsalAuth();

    expect(result.current.user?.id).toBe(42);
    expect(result.current.user?.role).toBe(Role.MANAGER);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('reports isLoading while the /me query is loading (authenticated)', () => {
    mockIsAuthenticated = true;
    mockUseMeReturn = { data: undefined, isLoading: true, isError: false };

    const { result } = renderMsalAuth();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it('keeps isLoading false when not authenticated even if the query reports loading', () => {
    // Contract: isAuthenticated ? isLoading : false — a signed-out user is never "loading".
    mockIsAuthenticated = false;
    mockUseMeReturn = { data: undefined, isLoading: true, isError: false };

    const { result } = renderMsalAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('exposes a null user when the /me fetch errors', () => {
    mockIsAuthenticated = true;
    mockUseMeReturn = { data: undefined, isLoading: false, isError: true };

    const { result } = renderMsalAuth();

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('login() calls msal loginRedirect', async () => {
    mockIsAuthenticated = false;

    const { result } = renderMsalAuth();

    await act(async () => {
      await result.current.login();
    });

    expect(mockLoginRedirect).toHaveBeenCalledTimes(1);
  });

  it('logout() clears the cached [me] query AND calls msal logoutRedirect', () => {
    mockIsAuthenticated = true;
    mockUseMeReturn = { data: makeUser({ id: 7 }), isLoading: false, isError: false };

    const { result } = renderMsalAuth();

    act(() => {
      result.current.logout();
    });

    expect(removeQueriesSpy).toHaveBeenCalledTimes(1);
    expect(removeQueriesSpy).toHaveBeenCalledWith({ queryKey: ['me'] });
    expect(mockLogoutRedirect).toHaveBeenCalledTimes(1);
  });

  it('logout() also clears any stored active role', () => {
    sessionStorage.setItem('active_role', Role.MANAGER);
    mockIsAuthenticated = true;
    mockUseMeReturn = {
      data: makeUser({ id: 7, role: Role.MANAGER, roles: [Role.MANAGER, Role.EMPLOYEE] }),
      isLoading: false,
      isError: false,
    };

    const { result } = renderMsalAuth();

    act(() => {
      result.current.logout();
    });

    expect(sessionStorage.getItem('active_role')).toBeNull();
  });

  it('switchRole persists the chosen role and refetches all queries', () => {
    mockIsAuthenticated = true;
    mockUseMeReturn = {
      data: makeUser({ id: 9, role: Role.MANAGER, roles: [Role.MANAGER, Role.EMPLOYEE] }),
      isLoading: false,
      isError: false,
    };
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderMsalAuth();

    act(() => {
      result.current.switchRole(Role.EMPLOYEE);
    });

    expect(sessionStorage.getItem('active_role')).toBe(Role.EMPLOYEE);
    // invalidateQueries() with no key refetches everything, including ['me'].
    expect(invalidateSpy).toHaveBeenCalledWith();
    invalidateSpy.mockRestore();
  });

  it('reconciles a stale stored role the user no longer holds', () => {
    sessionStorage.setItem('active_role', Role.ADMIN);
    mockIsAuthenticated = true;
    mockUseMeReturn = {
      data: makeUser({ id: 9, role: Role.MANAGER, roles: [Role.MANAGER, Role.EMPLOYEE] }),
      isLoading: false,
      isError: false,
    };
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    renderMsalAuth();

    // ADMIN isn't among the held roles → it's dropped and /me is refetched so the
    // server falls back to the highest role.
    expect(sessionStorage.getItem('active_role')).toBeNull();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] });
    invalidateSpy.mockRestore();
  });

  it('keeps a stored role the user still holds', () => {
    sessionStorage.setItem('active_role', Role.EMPLOYEE);
    mockIsAuthenticated = true;
    mockUseMeReturn = {
      data: makeUser({ id: 9, role: Role.EMPLOYEE, roles: [Role.MANAGER, Role.EMPLOYEE] }),
      isLoading: false,
      isError: false,
    };

    renderMsalAuth();

    expect(sessionStorage.getItem('active_role')).toBe(Role.EMPLOYEE);
  });
});
