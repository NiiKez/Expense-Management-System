import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { useQueryClient } from '@tanstack/react-query';
import { loginRequest } from '../services/auth';
import { IS_STUB_AUTH_MODE } from '../services/env';
import { clearStoredStubUser, getStoredStubUser, setStoredStubUser } from '../services/stubAuth';
import { clearDemoToken, getStoredDemoToken } from '../services/demoAuth';
import { clearStoredActiveRole, getStoredActiveRole, setStoredActiveRole } from '../services/activeRole';
import { useMe } from '../queries/me';
import type { Role, User } from '../types';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (stubUser?: User) => Promise<void>;
  logout: () => void;
  // Switch the role the user is acting as (only meaningful when they hold >1).
  // Persists the choice and refetches everything so the whole app follows.
  switchRole: (role: Role) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: () => {},
  switchRole: () => {},
});

function StubAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredStubUser);

  const login = useCallback(async (stubUser?: User) => {
    if (!stubUser) return;

    const storedUser = setStoredStubUser(stubUser);
    setUser(storedUser);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    clearStoredStubUser();
    clearStoredActiveRole();
  }, []);

  // Stub sessions are single-role, so the switcher never renders; the no-op just
  // satisfies the context shape. (Stub has no QueryClient ancestor to invalidate.)
  const switchRole = useCallback(() => {}, []);

  // Memoize so useAuth consumers don't re-render when this provider re-renders
  // without an actual auth change.
  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, isLoading: false, login, logout, switchRole }),
    [user, login, logout, switchRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function MsalAuthProvider({ children }: { children: ReactNode }) {
  const { instance } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const queryClient = useQueryClient();

  // The /me fetch is now a query, gated on authentication. When not
  // authenticated the query is disabled (idle, not loading), preserving the
  // previous `isLoading: false` contract for signed-out users.
  const { data, isLoading, isError } = useMe({ enabled: isAuthenticated });

  // Profile fetch outcome: the user object on success, null on error (matching
  // the old catch-sets-null behavior so ProtectedRoute can show its retry UI).
  const user: User | null = isAuthenticated && !isError ? data ?? null : null;

  const login = useCallback(async () => {
    await instance.loginRedirect(loginRequest);
  }, [instance]);

  const logout = useCallback(() => {
    // Drop the cached profile before the redirect so the navbar doesn't briefly
    // render "logged out but with stale data" while the redirect resolves.
    queryClient.removeQueries({ queryKey: ['me'] });
    clearStoredActiveRole();
    void instance.logoutRedirect();
  }, [instance, queryClient]);

  // Persist the desired role and refetch EVERYTHING (no key = all queries),
  // including ['me']: the server re-resolves the effective role from the
  // X-Active-Role header and the whole app follows user.role from the fresh /me.
  const switchRole = useCallback(
    (role: Role) => {
      setStoredActiveRole(role);
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  // Reconcile a stale stored role: if a previous session left an active role the
  // user no longer holds (e.g. their Entra assignment changed), drop it and
  // refetch /me so the server falls back to their highest role. Self-terminating:
  // once cleared, getStoredActiveRole() is null and the guard short-circuits.
  useEffect(() => {
    if (!user) return;
    const stored = getStoredActiveRole();
    if (stored && !user.roles?.includes(stored)) {
      clearStoredActiveRole();
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    }
  }, [user, queryClient]);

  // Memoize so useAuth consumers don't re-render on every MsalAuthProvider
  // render (MSAL state + the polled /me query re-render this often).
  const value = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoading: isAuthenticated ? isLoading : false,
      login,
      logout,
      switchRole,
    }),
    [user, isAuthenticated, isLoading, login, logout, switchRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Demo sandbox session: authentication is simply "we hold a demo token and /me
// resolves". No MSAL involvement; logout clears the token.
function DemoAuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useMe({ enabled: true });
  const user: User | null = !isError ? data ?? null : null;

  const logout = useCallback(() => {
    // Clear the session, then hard-navigate so the SPA tears down at once.
    // Without the navigation the still-mounted /me query refetches with the
    // token already gone, 401s, and the api interceptor — no longer seeing a
    // demo token — falls through to MSAL's acquireTokenRedirect, bouncing the
    // user through login.microsoftonline.com before they land on /login.
    clearDemoToken();
    clearStoredActiveRole();
    window.location.assign('/login');
  }, []);

  // Demo sessions hold a single role, so the switcher never renders; the no-op
  // just satisfies the context shape.
  const switchRole = useCallback(() => {}, []);

  const value = useMemo(
    () => ({
      user,
      // Holding a demo token IS the authenticated state (this provider only
      // mounts when one is stored) — kept separate from whether the /me profile
      // loaded, mirroring MsalAuthProvider. So a non-401 /me failure (e.g. the
      // scale-to-zero DB waking up) surfaces ProtectedRoute's in-place retry
      // screen instead of bouncing a still-valid session back to the picker. A
      // genuinely dead token 401s and the api interceptor clears it + redirects.
      isAuthenticated: true,
      isLoading,
      login: async () => {},
      logout,
      switchRole,
    }),
    [user, isLoading, logout, switchRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (IS_STUB_AUTH_MODE) {
    return <StubAuthProvider>{children}</StubAuthProvider>;
  }
  // A live demo token wins over MSAL so the visitor lands straight in the app.
  if (getStoredDemoToken()) {
    return <DemoAuthProvider>{children}</DemoAuthProvider>;
  }
  return <MsalAuthProvider>{children}</MsalAuthProvider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
