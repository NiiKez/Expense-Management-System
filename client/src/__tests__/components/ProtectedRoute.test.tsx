import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../../components/common/ProtectedRoute';
import { Role } from '../../types';
import type { User } from '../../types';

// Prevent PublicClientApplication from being constructed (requires Web Crypto API not in jsdom)
jest.mock('../../services/auth', () => ({
  msalInstance: { getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}));

// Mirror server pattern: mock the module, then control return value per test
jest.mock('../../context/AuthContext');

import { useAuth } from '../../context/AuthContext';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// ── Helpers ───────────────────────────────────────────────────────

function makeUser(role: Role): User {
  return {
    id: 1,
    entra_id: 'oid-123',
    email: 'user@example.com',
    display_name: 'Test User',
    role,
    manager_id: null,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

function renderRoute(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/protected" element={ui} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/" element={<div>Home Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// ── Tests ─────────────────────────────────────────────────────────

describe('ProtectedRoute', () => {
  describe('loading state', () => {
    it('should render loading indicator while auth is resolving', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false,
        isLoading: true,
        login: jest.fn(),
        logout: jest.fn(),
      });

      renderRoute(
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      );

      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('unauthenticated', () => {
    it('should redirect to /login when not authenticated', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        login: jest.fn(),
        logout: jest.fn(),
      });

      renderRoute(
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('authenticated, no role requirement', () => {
    it('should render children when authenticated and no role is required', () => {
      mockUseAuth.mockReturnValue({
        user: makeUser(Role.EMPLOYEE),
        isAuthenticated: true,
        isLoading: false,
        login: jest.fn(),
        logout: jest.fn(),
      });

      renderRoute(
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  describe('role enforcement — single role', () => {
    it('should render children when user has the required role', () => {
      mockUseAuth.mockReturnValue({
        user: makeUser(Role.ADMIN),
        isAuthenticated: true,
        isLoading: false,
        login: jest.fn(),
        logout: jest.fn(),
      });

      renderRoute(
        <ProtectedRoute requiredRole={Role.ADMIN}>
          <div>Admin Content</div>
        </ProtectedRoute>
      );

      expect(screen.getByText('Admin Content')).toBeInTheDocument();
    });

    it('should redirect to / when user has the wrong role', () => {
      mockUseAuth.mockReturnValue({
        user: makeUser(Role.EMPLOYEE),
        isAuthenticated: true,
        isLoading: false,
        login: jest.fn(),
        logout: jest.fn(),
      });

      renderRoute(
        <ProtectedRoute requiredRole={Role.ADMIN}>
          <div>Admin Content</div>
        </ProtectedRoute>
      );

      expect(screen.getByText('Home Page')).toBeInTheDocument();
      expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
    });
  });

  describe('role enforcement — array of roles', () => {
    it('should allow access when user role is in the allowed array', () => {
      mockUseAuth.mockReturnValue({
        user: makeUser(Role.MANAGER),
        isAuthenticated: true,
        isLoading: false,
        login: jest.fn(),
        logout: jest.fn(),
      });

      renderRoute(
        <ProtectedRoute requiredRole={[Role.MANAGER, Role.ADMIN]}>
          <div>Manager/Admin Content</div>
        </ProtectedRoute>
      );

      expect(screen.getByText('Manager/Admin Content')).toBeInTheDocument();
    });

    it('should redirect to / when user role is not in the allowed array', () => {
      mockUseAuth.mockReturnValue({
        user: makeUser(Role.EMPLOYEE),
        isAuthenticated: true,
        isLoading: false,
        login: jest.fn(),
        logout: jest.fn(),
      });

      renderRoute(
        <ProtectedRoute requiredRole={[Role.MANAGER, Role.ADMIN]}>
          <div>Manager/Admin Content</div>
        </ProtectedRoute>
      );

      expect(screen.getByText('Home Page')).toBeInTheDocument();
      expect(screen.queryByText('Manager/Admin Content')).not.toBeInTheDocument();
    });
  });
});
