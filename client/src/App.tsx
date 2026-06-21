import { Routes, Route, Link } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import ProtectedRoute from './components/common/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SubmitExpense from './pages/SubmitExpense';
import MyExpenses from './pages/MyExpenses';
import Approvals from './pages/Approvals';
import Admin from './pages/Admin';
import ManagerEmployees from './pages/ManagerEmployees';
import Settings from './pages/Settings';
import ExpenseDetail from './components/expenses/ExpenseDetail';
import EditExpense from './pages/EditExpense';
import { Role } from './types';

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">404 — Not Found</h1>
      <p className="text-muted-foreground">The page you requested doesn't exist.</p>
      <Link to="/" className="text-sm underline underline-offset-4 hover:text-primary">Go home</Link>
    </div>
  );
}

function App() {
  // The per-route fade + remount lives inside AppShell (around the page body), so
  // navigating no longer tears down the persistent sidebar/topbar and their queries.
  return (
    <Routes>
      {/* Bare route — no shell */}
      <Route path="/login" element={<Login />} />

      {/* Authenticated routes wrapped in AppShell */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell title="Dashboard">
              <Dashboard />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses/new"
        element={
          <ProtectedRoute>
            <AppShell title="New expense">
              <SubmitExpense />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses"
        element={
          <ProtectedRoute>
            <AppShell title="My expenses">
              <MyExpenses />
            </AppShell>
          </ProtectedRoute>
        }
      />
      {/* More-specific route must come before /expenses/:id */}
      <Route
        path="/expenses/:id/edit"
        element={
          <ProtectedRoute>
            <AppShell title="Edit expense">
              <EditExpense />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses/:id"
        element={
          <ProtectedRoute>
            <AppShell title="Expense">
              <ExpenseDetail />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/approvals"
        element={
          <ProtectedRoute requiredRole={[Role.MANAGER, Role.ADMIN]}>
            <AppShell title="Approvals">
              <Approvals />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/manager/employees"
        element={
          <ProtectedRoute requiredRole={Role.MANAGER}>
            <AppShell title="Team">
              <ManagerEmployees />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute requiredRole={Role.ADMIN}>
            <AppShell title="Admin">
              <Admin />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <AppShell title="Settings">
              <Settings />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="*"
        element={
          <AppShell>
            <NotFound />
          </AppShell>
        }
      />
    </Routes>
  );
}

export default App;
