// Mock MSAL before api.ts is imported, so PublicClientApplication is never instantiated
jest.mock('../../services/auth', () => ({
  msalInstance: {
    getAllAccounts: jest.fn(() => []),
    acquireTokenSilent: jest.fn(),
  },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}));

import api from '../../services/api';

// ── Tests ──────────────────────────────────────────────────────────

describe('api service', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('axios instance config', () => {
    it('uses the VITE_API_URL base URL', () => {
      // VITE_API_URL is set to 'http://localhost:4444/api/v1' in setupTests.ts
      expect(api.defaults.baseURL).toBe('http://localhost:4444/api/v1');
    });

    // Intentional design: NO global Content-Type is set on the axios instance.
    // Setting application/json globally would cause axios to serialise FormData
    // payloads as "{}" (via formDataToJSON), silently dropping receipt uploads.
    // Axios picks the correct header per request: application/json for plain
    // objects and multipart/form-data (with boundary) for FormData.
    it('does NOT set a global Content-Type so FormData uploads keep multipart/form-data', () => {
      expect(api.defaults.headers['Content-Type']).toBeUndefined();
    });
  });

  describe('stub-mode request interceptor', () => {
    // VITE_AUTH_MODE=stub is set in setupTests.ts, so the stub branch is active

    it('attaches X-Stub-User-Id header when a known stub user id is in sessionStorage', async () => {
      sessionStorage.setItem('stub_user_id', '5');

      // Exercise the interceptor by extracting it from the handler stack and calling it directly
      const handlers = (api.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (config: Record<string, unknown>) => unknown }>;
      }).handlers;
      const interceptor = handlers[handlers.length - 1].fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers['X-Stub-User-Id']).toBe('5');
      expect((result as typeof config).headers['X-Stub-Auth-Secret']).toBeUndefined();
    });

    it('does not attach X-Stub-User-Id when no stub user id is in sessionStorage', async () => {
      const handlers = (api.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (config: Record<string, unknown>) => unknown }>;
      }).handlers;
      const interceptor = handlers[handlers.length - 1].fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers['X-Stub-User-Id']).toBeUndefined();
    });

    it('does not attach X-Stub-User-Id when stored stub user id is unknown', async () => {
      sessionStorage.setItem('stub_user_id', '999');

      const handlers = (api.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (config: Record<string, unknown>) => unknown }>;
      }).handlers;
      const interceptor = handlers[handlers.length - 1].fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers['X-Stub-User-Id']).toBeUndefined();
    });
  });
});
