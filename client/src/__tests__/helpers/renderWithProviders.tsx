import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '../../types';

// Shape of the value returned by useAuth
export interface MockAuthValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: jest.Mock;
  logout: jest.Mock;
  switchRole: jest.Mock;
}

export function makeMockAuthValue(overrides: Partial<MockAuthValue> = {}): MockAuthValue {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
    switchRole: jest.fn(),
    ...overrides,
  };
}

/**
 * An isolated QueryClient for tests: retries off (so assertions don't wait on
 * backoff) and gcTime Infinity (cache never collected mid-test). Build a fresh
 * one per test to avoid cross-test cache bleed.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * Wrapper + client for `renderHook` on a react-query hook. Replaces the identical
 * `makeWrapper()` that every queries/* test hand-rolled — one place to add a
 * provider or tweak client options. Returns the fresh isolated client too so tests
 * can `jest.spyOn(client, 'invalidateQueries')`.
 */
export function createQueryWrapper(queryClient?: QueryClient): {
  client: QueryClient;
  wrapper: ({ children }: { children: React.ReactNode }) => React.ReactElement;
} {
  const client = queryClient ?? createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

interface RenderOptions {
  initialEntries?: string[];
  /** Supply a custom client (e.g. one shared with a renderHook wrapper). */
  queryClient?: QueryClient;
}

/**
 * Renders `ui` inside a QueryClientProvider + MemoryRouter.
 *
 * For auth-dependent components, call `jest.mock('../../context/AuthContext')` in
 * the test file and set `mockUseAuth.mockReturnValue(makeMockAuthValue(...))` — the
 * same pattern used in ProtectedRoute.test.tsx. This helper supplies the router
 * and a fresh isolated query client (override via options.queryClient).
 */
export function renderWithProviders(
  ui: React.ReactElement,
  { initialEntries = ['/'], queryClient }: RenderOptions = {}
): RenderResult {
  const client = queryClient ?? createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}
