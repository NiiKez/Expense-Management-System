import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { useQueryClient } from '@tanstack/react-query';
import { loginRequest } from '../services/auth';
import { IS_STUB_AUTH_MODE } from '../services/env';
import { clearStoredStubUser, getStoredStubUser, setStoredStubUser } from '../services/stubAuth';
import { useMe } from '../queries/me';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (stubUser?: User) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: () => {},
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
  }, []);

  // Memoize so useAuth consumers don't re-render when this provider re-renders
  // without an actual auth change.
  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, isLoading: false, login, logout }),
    [user, login, logout],
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
    void instance.logoutRedirect();
  }, [instance, queryClient]);

  // Memoize so useAuth consumers don't re-render on every MsalAuthProvider
  // render (MSAL state + the polled /me query re-render this often).
  const value = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoading: isAuthenticated ? isLoading : false,
      login,
      logout,
    }),
    [user, isAuthenticated, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (IS_STUB_AUTH_MODE) {
    return <StubAuthProvider>{children}</StubAuthProvider>;
  }
  return <MsalAuthProvider>{children}</MsalAuthProvider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
