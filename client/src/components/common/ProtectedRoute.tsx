import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: Role | Role[];
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="loading" role="status" aria-live="polite">Loading...</div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!user) {
    // Authenticated but profile fetch failed — likely a stale token or backend
    // outage. Offer the user a clear path out instead of a dead-end message.
    return (
      <div className="loading" role="alert">
        <p>Unable to load your profile.</p>
        <button type="button" onClick={() => window.location.reload()}>Retry</button>
        <button type="button" onClick={logout}>Sign out</button>
      </div>
    );
  }

  if (requiredRole) {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!allowed.includes(user.role)) {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}
