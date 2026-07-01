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

// Observe a window.location.assign('/login') hard-navigation. jsdom LOCKS location:
// verified empirically that both `window.location` (a non-configurable accessor) and
// its `assign` (an own, non-writable, non-configurable method) can be neither spied nor
// replaced — so the '/login' argument itself is unobservable, and the target URL never
// appears in the error jsdom emits. What IS observable is the jsdom "Not implemented:
// navigation" jsdomError, forwarded to console.error — the concrete side-effect of
// assign(). We capture console.error and count ONLY navigation errors: strictly stronger
// than the old `toHaveBeenCalled()` (any stray log satisfied that), proving a real
// navigation fired exactly once. NB: the jsdomError originates in jsdom's own realm, so
// `arg instanceof Error` is false in the test realm — we match on the message string.
function navMessage(a: unknown): string {
  const msg = (a as { message?: unknown })?.message;
  return typeof msg === 'string' ? msg : String(a);
}
function captureNavigationErrors() {
  const calls: unknown[][] = [];
  const spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    calls.push(args);
  });
  return {
    navErrors: () =>
      calls.filter((args) => args.some((a) => /navigation/i.test(navMessage(a)))).length,
    restore: () => spy.mockRestore(),
  };
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

    // Demo precedence over stub: a stored demo token is checked BEFORE the stub
    // branch, so even in stub mode it wins — the request carries the demo Bearer
    // and never the X-Stub-User-Id header. demoAuth is the real sessionStorage-backed
    // module here (only services/auth is mocked at the top), so setting the key is enough.
    it('prefers a stored demo token over the stub user id (Bearer, no X-Stub-User-Id)', async () => {
      sessionStorage.setItem('stub_user_id', '5');
      sessionStorage.setItem('demo_token', 'demo-tok-1');

      const handlers = (api.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (config: Record<string, unknown>) => unknown }>;
      }).handlers;
      const interceptor = handlers[handlers.length - 1]!.fulfilled;

      const config = { headers: {} as Record<string, string> };
      const result = await interceptor(config);

      expect((result as typeof config).headers.Authorization).toBe('Bearer demo-tok-1');
      expect((result as typeof config).headers['X-Stub-User-Id']).toBeUndefined();
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

    it('releases the redirect guard when acquireTokenRedirect itself throws, so a later 401 can retry', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      // Regression guard for api.ts's 401 catch: if the FIRST acquireTokenRedirect
      // rejects (e.g. MSAL refuses to start interaction) and redirectInFlight is not
      // reset, the flag stays permanently true and NO future 401 ever re-auths again.
      // First attempt rejects; all later attempts use the default resolving impl.
      msalInstance.acquireTokenRedirect
        .mockRejectedValueOnce(new Error('redirect refused'))
        .mockResolvedValue(undefined);

      const rejected = getResponseRejectedHandler(msalApi);
      const error401 = { response: { status: 401 } };

      // First 401: redirect throws → catch resets the guard → interceptor returns a
      // never-resolving promise. Flush a macrotask so the catch has definitely run
      // before the second 401 observes the (now released) guard.
      const first = rejected(error401);
      first.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Second 401: guard released ⇒ a fresh redirect MUST fire (proving the release).
      const second = rejected(error401);
      second.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(msalInstance.acquireTokenRedirect).toHaveBeenCalledTimes(2);
    });
  });

  // ── Stub-mode 401 response interceptor (default stub env) ─────────
  // The top-level `api` import runs under the real stub env (VITE_AUTH_MODE=stub +
  // localhost, non-prod), so IS_STUB_AUTH_MODE is true. The reauth branch is gated
  // behind `!IS_STUB_AUTH_MODE`, so a stub 401 must simply propagate — there is no
  // MSAL redirect to run. Every MSAL-path test above forces the production branch via
  // loadMsalApi(), leaving this stub branch otherwise unexercised.
  describe('stub-mode 401 response interceptor (default stub env)', () => {
    it('rejects a 401 with the original error and never triggers an MSAL redirect', async () => {
      // The hoisted top-level services/auth mock is what the stub-env `api` closes
      // over; grab it to prove acquireTokenRedirect stays untouched here.
      const auth = jest.requireMock('../../services/auth') as {
        msalInstance: { acquireTokenRedirect: jest.Mock };
      };
      auth.msalInstance.acquireTokenRedirect.mockClear();

      const rejected = getResponseRejectedHandler(api);
      const error401 = { response: { status: 401 } };

      await expect(rejected(error401)).rejects.toBe(error401);
      expect(auth.msalInstance.acquireTokenRedirect).not.toHaveBeenCalled();
    });
  });

  // ── Demo-session interceptors (production path) ───────────────────
  // demoAuth is the real sessionStorage-backed module (loadMsalApi only doMocks
  // env + auth), so a stored `demo_token` drives the demo branch of both
  // interceptors. NB: window.location is non-configurable under jsdom 30, so
  // assign('/login') can't be spied; it surfaces as a jsdom "Not implemented:
  // navigation" console.error, which we silence and treat as proof the redirect
  // fired — the same navigation-side-effect pattern Login.test.tsx relies on.
  describe('demo-session interceptors (production path)', () => {
    it('attaches the demo Bearer and short-circuits MSAL (no acquireTokenSilent)', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      // An active account exists, so MSAL WOULD run if the demo branch didn't win.
      msalInstance.getActiveAccount.mockReturnValue({ homeAccountId: 'acc-1' });
      sessionStorage.setItem('demo_token', 'demo-jwt-abc');

      const interceptor = getRequestInterceptor(msalApi);
      const result = await interceptor({ headers: {} });

      expect(result.headers.Authorization).toBe('Bearer demo-jwt-abc');
      expect(msalInstance.acquireTokenSilent).not.toHaveBeenCalled();
      expect(result.headers['X-Stub-User-Id']).toBeUndefined();
    });

    it('clears the demo token and redirects to /login on a 401 response', async () => {
      const { api: msalApi, msalInstance } = await loadMsalApi();
      sessionStorage.setItem('demo_token', 'demo-jwt-abc');
      const nav = captureNavigationErrors();

      const rejected = getResponseRejectedHandler(msalApi);
      // The demo 401 branch runs synchronously (no await before assign) then returns
      // a never-resolving promise (page navigating away), so don't await it — just
      // guard against a stray rejection crashing the worker.
      const pending = rejected({ response: { status: 401 } });
      pending.catch(() => {});

      expect(sessionStorage.getItem('demo_token')).toBeNull(); // clearDemoToken() ran
      // window.location.assign('/login') fired exactly one hard navigation (see
      // captureNavigationErrors: jsdom locks location so the '/login' arg is
      // unobservable, but the single navigation side-effect is).
      expect(nav.navErrors()).toBe(1);
      // Demo sessions never fall through to MSAL's silent-reauth redirect.
      expect(msalInstance.acquireTokenRedirect).not.toHaveBeenCalled();
      nav.restore();
    });

    it('rejects a non-401 demo error with the original error and keeps the token', async () => {
      const { api: msalApi } = await loadMsalApi();
      sessionStorage.setItem('demo_token', 'demo-jwt-abc');
      const rejected = getResponseRejectedHandler(msalApi);
      const error500 = { response: { status: 500 } };

      await expect(rejected(error500)).rejects.toBe(error500);
      // A transient (e.g. DB waking) error must NOT nuke a still-valid demo session.
      expect(sessionStorage.getItem('demo_token')).toBe('demo-jwt-abc');
    });
  });
});
