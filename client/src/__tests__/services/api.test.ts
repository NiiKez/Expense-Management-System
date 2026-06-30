// Mock MSAL before api.ts is imported, so PublicClientApplication is never instantiated.
// api.ts calls getActiveAccount() FIRST (falling back to getAllAccounts()[0]), then
// acquireTokenSilent, and acquireTokenRedirect on interaction-required / 401 — so all
// four are wired here even though the stub-mode tests below only exercise none of them.
jest.mock('../../services/auth', () => ({
  msalInstance: {
    getActiveAccount: jest.fn(() => null),
    getAllAccounts: jest.fn(() => []),
    acquireTokenSilent: jest.fn(),
    acquireTokenRedirect: jest.fn(),
  },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: ['api://test/access_as_user'] },
}));

import api from '../../services/api';

// Re-imports api.ts with IS_STUB_AUTH_MODE forced false (production MSAL path) and a
// fresh mock of services/auth, then returns both the api instance and the auth mock so
// the MSAL request/response interceptors can be exercised in isolation. Using
// isolateModulesAsync keeps these module-graph overrides from leaking into the
// stub-mode tests above (which rely on the real, stub env).
async function loadMsalApi() {
  let mod!: { default: typeof api };
  let authMock!: {
    msalInstance: {
      getActiveAccount: jest.Mock;
      getAllAccounts: jest.Mock;
      acquireTokenSilent: jest.Mock;
      acquireTokenRedirect: jest.Mock;
    };
    loginRequest: { scopes: string[] };
  };
  // Captured from INSIDE the isolate so it's the exact same class instance api.ts
  // imported. Constructing it from an outside import would be a different module
  // instance, breaking api.ts's `err instanceof InteractionRequiredAuthError`.
  let InteractionRequiredAuthError!: new (code?: string) => Error;

  await jest.isolateModulesAsync(async () => {
    jest.doMock('../../services/env', () => ({
      __esModule: true,
      API_BASE_URL: 'http://localhost:4444/api/v1',
      IS_STUB_AUTH_MODE: false,
    }));
    jest.doMock('../../services/auth', () => ({
      __esModule: true,
      msalInstance: {
        getActiveAccount: jest.fn(() => null),
        getAllAccounts: jest.fn(() => []),
        acquireTokenSilent: jest.fn(),
        acquireTokenRedirect: jest.fn().mockResolvedValue(undefined),
      },
      msalReady: Promise.resolve(),
      loginRequest: { scopes: ['api://test/access_as_user'] },
    }));

    mod = (await import('../../services/api')) as unknown as { default: typeof api };
    authMock = (await import('../../services/auth')) as unknown as typeof authMock;
    ({ InteractionRequiredAuthError } = (await import('@azure/msal-browser')) as unknown as {
      InteractionRequiredAuthError: new (code?: string) => Error;
    });
  });

  // api.ts is freshly re-imported per isolate (so its module-scoped redirectInFlight
  // resets to false), but the hoisted top-level jest.mock('../../services/auth') is a
  // single shared object whose jest.fn() call history persists across loads. Reset its
  // mocks to a clean, default-implementation state so each test starts fresh.
  const { msalInstance } = authMock;
  msalInstance.getActiveAccount.mockReset().mockReturnValue(null);
  msalInstance.getAllAccounts.mockReset().mockReturnValue([]);
  msalInstance.acquireTokenSilent.mockReset();
  msalInstance.acquireTokenRedirect.mockReset().mockResolvedValue(undefined);

  return { api: mod.default, msalInstance, InteractionRequiredAuthError };
}

type InterceptorConfig = { headers: Record<string, string> };

// Pulls the most-recently-registered request interceptor's fulfilled handler off the
// axios handler stack — the same technique the stub-mode tests use to call it directly.
function getRequestInterceptor(instance: typeof api) {
  const handlers = (instance.interceptors.request as unknown as {
    handlers: Array<{ fulfilled: (config: InterceptorConfig) => Promise<InterceptorConfig> }>;
  }).handlers;
  return handlers[handlers.length - 1]!.fulfilled;
}

// Pulls the response interceptor's rejected handler (index 1 of the use() args).
function getResponseRejectedHandler(instance: typeof api) {
  const handlers = (instance.interceptors.response as unknown as {
    handlers: Array<{ rejected: (err: unknown) => Promise<unknown> }>;
  }).handlers;
  return handlers[handlers.length - 1]!.rejected;
}

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
      const interceptor = handlers[handlers.length - 1]!.fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers['X-Stub-User-Id']).toBe('5');
      expect((result as typeof config).headers['X-Stub-Auth-Secret']).toBeUndefined();
    });

    it('does not attach X-Stub-User-Id when no stub user id is in sessionStorage', async () => {
      const handlers = (api.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (config: Record<string, unknown>) => unknown }>;
      }).handlers;
      const interceptor = handlers[handlers.length - 1]!.fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers['X-Stub-User-Id']).toBeUndefined();
    });

    it('does not attach X-Stub-User-Id when stored stub user id is unknown', async () => {
      sessionStorage.setItem('stub_user_id', '999');

      const handlers = (api.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (config: Record<string, unknown>) => unknown }>;
      }).handlers;
      const interceptor = handlers[handlers.length - 1]!.fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers['X-Stub-User-Id']).toBeUndefined();
    });

    it('attaches the X-Active-Role header when a valid active role is stored', async () => {
      sessionStorage.setItem('active_role', 'MANAGER');

      const handlers = (api.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (config: Record<string, unknown>) => unknown }>;
      }).handlers;
      const interceptor = handlers[handlers.length - 1]!.fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers['X-Active-Role']).toBe('MANAGER');
    });

    it('does not attach X-Active-Role when nothing is stored', async () => {
      const handlers = (api.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (config: Record<string, unknown>) => unknown }>;
      }).handlers;
      const interceptor = handlers[handlers.length - 1]!.fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers['X-Active-Role']).toBeUndefined();
    });
  });

  // ── Production MSAL path (IS_STUB_AUTH_MODE forced false) ──────────
  describe('MSAL request interceptor (production path)', () => {
    it('attaches a Bearer token from acquireTokenSilent when an active account exists', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      const account = { homeAccountId: 'acc-1', username: 'alice@example.com' };
      msalInstance.getActiveAccount.mockReturnValue(account);
      msalInstance.acquireTokenSilent.mockResolvedValue({ accessToken: 'silent-token-123' });

      const interceptor = getRequestInterceptor(msalApi);
      const result = await interceptor({ headers: {} });

      expect(msalInstance.acquireTokenSilent).toHaveBeenCalledTimes(1);
      // Called with the spread loginRequest plus the resolved account
      expect(msalInstance.acquireTokenSilent).toHaveBeenCalledWith(
        expect.objectContaining({ account, scopes: ['api://test/access_as_user'] }),
      );
      expect(result.headers.Authorization).toBe('Bearer silent-token-123');
    });

    it('falls back to getAllAccounts()[0] when there is no active account', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      const fallbackAccount = { homeAccountId: 'acc-2', username: 'bob@example.com' };
      msalInstance.getActiveAccount.mockReturnValue(null);
      msalInstance.getAllAccounts.mockReturnValue([fallbackAccount]);
      msalInstance.acquireTokenSilent.mockResolvedValue({ accessToken: 'fallback-token' });

      const interceptor = getRequestInterceptor(msalApi);
      const result = await interceptor({ headers: {} });

      expect(msalInstance.acquireTokenSilent).toHaveBeenCalledWith(
        expect.objectContaining({ account: fallbackAccount }),
      );
      expect(result.headers.Authorization).toBe('Bearer fallback-token');
    });

    it('does not attach Authorization and passes the config through when no account exists', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      msalInstance.getActiveAccount.mockReturnValue(null);
      msalInstance.getAllAccounts.mockReturnValue([]);

      const interceptor = getRequestInterceptor(msalApi);
      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect(msalInstance.acquireTokenSilent).not.toHaveBeenCalled();
      expect(result.headers.Authorization).toBeUndefined();
      expect(result).toBe(config);
    });

    it('triggers acquireTokenRedirect and never resolves on InteractionRequiredAuthError', async () => {
      const { api: msalApi, msalInstance, InteractionRequiredAuthError } = await loadMsalApi();
      msalInstance.getActiveAccount.mockReturnValue({ homeAccountId: 'acc-1' });
      msalInstance.acquireTokenSilent.mockRejectedValue(
        new InteractionRequiredAuthError('interaction_required'),
      );

      const interceptor = getRequestInterceptor(msalApi);

      // The interceptor returns a never-resolving promise (page is navigating away),
      // so race it against a short timer: the timer must win, proving no resolution.
      const interceptorPromise = interceptor({ headers: {} });
      const sentinel = Symbol('pending');
      const race = await Promise.race([
        interceptorPromise.then(() => 'resolved'),
        new Promise((resolve) => setTimeout(() => resolve(sentinel), 20)),
      ]);

      expect(msalInstance.acquireTokenRedirect).toHaveBeenCalledTimes(1);
      expect(msalInstance.acquireTokenRedirect).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: ['api://test/access_as_user'] }),
      );
      expect(race).toBe(sentinel);
    });

    it('rejects with the original error for non-interaction acquireTokenSilent failures', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      msalInstance.getActiveAccount.mockReturnValue({ homeAccountId: 'acc-1' });
      const networkError = new Error('network down');
      msalInstance.acquireTokenSilent.mockRejectedValue(networkError);

      const interceptor = getRequestInterceptor(msalApi);

      await expect(interceptor({ headers: {} })).rejects.toBe(networkError);
      expect(msalInstance.acquireTokenRedirect).not.toHaveBeenCalled();
    });
  });

  describe('MSAL 401 response interceptor (production path)', () => {
    it('triggers a single acquireTokenRedirect on a 401 and guards concurrent 401s', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      // Hold the redirect open so the redirectInFlight guard stays set while a second
      // 401 arrives concurrently — mirroring a page about to navigate away.
      let resolveRedirect!: () => void;
      msalInstance.acquireTokenRedirect.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveRedirect = resolve;
        }),
      );

      const rejected = getResponseRejectedHandler(msalApi);
      const error401 = { response: { status: 401 } };

      // First 401: redirect fires and the interceptor returns a never-resolving
      // promise (page navigating away) — attach a catch so a stray rejection can't
      // crash the worker. Second concurrent 401: the redirectInFlight guard is set,
      // so it must NOT fire a redirect and instead rejects with the original error.
      const first = rejected(error401);
      first.catch(() => {});
      const second = rejected(error401);

      await expect(second).rejects.toBe(error401);
      expect(msalInstance.acquireTokenRedirect).toHaveBeenCalledTimes(1);
      resolveRedirect();
    });

    it('passes non-401 errors straight through (rejects with the original error)', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      const rejected = getResponseRejectedHandler(msalApi);
      const error500 = { response: { status: 500 } };

      await expect(rejected(error500)).rejects.toBe(error500);
      expect(msalInstance.acquireTokenRedirect).not.toHaveBeenCalled();
    });
  });
});
