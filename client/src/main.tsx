import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MsalProvider } from '@azure/msal-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { msalInstance, msalReady } from './services/auth';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from '@/lib/theme';
import { queryClient } from '@/lib/queryClient';
import { AppErrorBoundary } from '@/components/common/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import { IS_STUB_AUTH_MODE } from './services/env';
import App from './App';
import './index.css';

async function renderApp() {
  if (!IS_STUB_AUTH_MODE) {
    await msalReady;
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* QueryClientProvider is the outermost app provider so AuthContext (and
          everything below) can use queries. */}
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider>
            {IS_STUB_AUTH_MODE ? (
              <AuthProvider>
                <AppErrorBoundary>
                  <App />
                </AppErrorBoundary>
                <Toaster />
              </AuthProvider>
            ) : (
              <MsalProvider instance={msalInstance}>
                <AuthProvider>
                  <AppErrorBoundary>
                    <App />
                  </AppErrorBoundary>
                  <Toaster />
                </AuthProvider>
              </MsalProvider>
            )}
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

renderApp();
