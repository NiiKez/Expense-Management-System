// Cover services/auth.ts — the MSAL bootstrap that runs entirely as module
// side-effects at import time: a production env-guard, the msalConfig literal,
// `new PublicClientApplication(...)`, and the initialize → handleRedirectPromise
// account-resolution chain exposed as `msalReady`.
//
// No test imports auth.ts at the top level (instantiating a real
// PublicClientApplication needs Web Crypto, absent in jsdom — the same reason the
// sibling api.test.ts mocks this module). Instead each case re-imports it under
// `jest.isolateModulesAsync` with `@azure/msal-browser` and `./env` mocked, so the
// side effects re-run against fresh, controllable inputs. `import.meta.env.PROD`
// in auth.ts is rewritten to `process.env.PROD` by the importMetaTransformer, so we
// drive the prod branch by toggling that env var around each isolated import.

type MsalAccount = { homeAccountId: string };

interface LoadOpts {
  /** Drives `import.meta.env.PROD` (→ process.env.PROD) for the prod env-guard. */
  prod?: boolean;
  entraClientId?: string;
  entraTenantId?: string;
  loginScopes?: string[];
  redirectUri?: string;
  /** Resolved value of msalInstance.handleRedirectPromise(). */
  redirectResponse?: { account?: MsalAccount } | null;
  /** Return of msalInstance.getActiveAccount(). */
  activeAccount?: MsalAccount | null;
  /** Return of msalInstance.getAllAccounts(). */
  allAccounts?: MsalAccount[];
}

interface MsalInstanceMock {
  initialize: jest.Mock;
  handleRedirectPromise: jest.Mock;
  getActiveAccount: jest.Mock;
  getAllAccounts: jest.Mock;
  setActiveAccount: jest.Mock;
}

async function loadAuth(opts: LoadOpts = {}) {
  const {
    prod = false,
    entraClientId = 'unit-client-id',
    entraTenantId = 'unit-tenant-id',
    loginScopes = ['api://unit-client-id/access_as_user'],
    redirectUri = 'http://localhost:5173',
    redirectResponse = null,
    activeAccount = null,
    allAccounts = [],
  } = opts;

  const instance: MsalInstanceMock = {
    initialize: jest.fn().mockResolvedValue(undefined),
    handleRedirectPromise: jest.fn().mockResolvedValue(redirectResponse),
    getActiveAccount: jest.fn().mockReturnValue(activeAccount),
    getAllAccounts: jest.fn().mockReturnValue(allAccounts),
    setActiveAccount: jest.fn(),
  };
  const PublicClientApplication = jest.fn().mockImplementation(() => instance);

  let mod: typeof import('../../services/auth') | undefined;
  let error: unknown;

  const prevProd = process.env.PROD;
  if (prod) process.env.PROD = 'true';
  else delete process.env.PROD;

  try {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('@azure/msal-browser', () => ({
        __esModule: true,
        PublicClientApplication,
      }));
      jest.doMock('../../services/env', () => ({
        __esModule: true,
        ENTRA_CLIENT_ID: entraClientId,
        ENTRA_TENANT_ID: entraTenantId,
        LOGIN_SCOPES: loginScopes,
        REDIRECT_URI: redirectUri,
      }));

      try {
        mod = await import('../../services/auth');
      } catch (e) {
        error = e;
      }
    });
  } finally {
    if (prevProd === undefined) delete process.env.PROD;
    else process.env.PROD = prevProd;
  }

  return {
    mod,
    error,
    instance,
    PublicClientApplication,
    // The Configuration passed to `new PublicClientApplication(msalConfig)`.
    config: PublicClientApplication.mock.calls[0]?.[0] as
      | {
          auth: { clientId: string; authority: string; redirectUri: string };
          cache: { cacheLocation: string };
        }
      | undefined,
  };
}

describe('services/auth', () => {
  describe('production env-guard', () => {
    it('throws and never constructs MSAL when ENTRA_CLIENT_ID is missing in a production build', async () => {
      const { error, PublicClientApplication } = await loadAuth({ prod: true, entraClientId: '' });

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('VITE_ENTRA_CLIENT_ID is required for production builds');
      // The guard runs before `new PublicClientApplication`, so MSAL is never built.
      expect(PublicClientApplication).not.toHaveBeenCalled();
    });

    it('does not throw in a production build when ENTRA_CLIENT_ID is present', async () => {
      const { error, PublicClientApplication } = await loadAuth({ prod: true, entraClientId: 'prod-client-id' });

      expect(error).toBeUndefined();
      expect(PublicClientApplication).toHaveBeenCalledTimes(1);
    });

    it('does not throw in a non-production (dev/stub) build even without ENTRA_CLIENT_ID', async () => {
      const { error, PublicClientApplication } = await loadAuth({ prod: false, entraClientId: '' });

      expect(error).toBeUndefined();
      expect(PublicClientApplication).toHaveBeenCalledTimes(1);
    });
  });

  describe('MSAL config construction', () => {
    it('builds msalConfig from the env values and uses tab-scoped sessionStorage', async () => {
      const { config, mod, instance } = await loadAuth({
        entraClientId: 'cfg-client',
        entraTenantId: 'cfg-tenant',
        redirectUri: 'http://localhost:5173/cb',
      });

      expect(config).toEqual({
        auth: {
          clientId: 'cfg-client',
          authority: 'https://login.microsoftonline.com/cfg-tenant',
          redirectUri: 'http://localhost:5173/cb',
        },
        cache: { cacheLocation: 'sessionStorage' },
      });
      // The exported instance is exactly the one built from msalConfig.
      expect(mod!.msalInstance).toBe(instance);
    });

    it('exposes loginRequest with the env-provided scopes', async () => {
      const scopes = ['api://cfg-client/access_as_user'];
      const { mod } = await loadAuth({ loginScopes: scopes });

      expect(mod!.loginRequest).toEqual({ scopes });
    });
  });

  describe('msalReady redirect handling', () => {
    it('initializes, processes the redirect promise, and sets the redirect account active', async () => {
      const account = { homeAccountId: 'redirect-acc' };
      const { mod, instance } = await loadAuth({ redirectResponse: { account } });

      const resolved = await mod!.msalReady;

      expect(instance.initialize).toHaveBeenCalledTimes(1);
      expect(instance.handleRedirectPromise).toHaveBeenCalledTimes(1);
      expect(instance.setActiveAccount).toHaveBeenCalledWith(account);
      // msalReady resolves to the redirect response so callers can react to it.
      expect(resolved).toEqual({ account });
    });

    it('falls back to getActiveAccount() when the redirect carried no account', async () => {
      const account = { homeAccountId: 'active-acc' };
      const { mod, instance } = await loadAuth({ redirectResponse: null, activeAccount: account });

      await mod!.msalReady;

      expect(instance.setActiveAccount).toHaveBeenCalledWith(account);
    });

    it('falls back to getAllAccounts()[0] when there is no redirect and no active account', async () => {
      const account = { homeAccountId: 'cached-acc' };
      const { mod, instance } = await loadAuth({
        redirectResponse: null,
        activeAccount: null,
        allAccounts: [account],
      });

      await mod!.msalReady;

      expect(instance.setActiveAccount).toHaveBeenCalledWith(account);
    });

    it('does not set an active account when none can be resolved', async () => {
      const { mod, instance } = await loadAuth({
        redirectResponse: null,
        activeAccount: null,
        allAccounts: [],
      });

      const resolved = await mod!.msalReady;

      expect(instance.setActiveAccount).not.toHaveBeenCalled();
      expect(resolved).toBeNull();
    });
  });
});
