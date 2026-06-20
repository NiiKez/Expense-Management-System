/**
 * Unit tests for the security-critical MSAL config validation in
 * src/services/env.ts.
 *
 * IMPORTANT — how env is fed to these tests:
 * env.ts reads Vite-style `import.meta.env.*` values. The ts-jest AST
 * transformer (src/__tests__/helpers/importMetaTransformer.ts) rewrites those
 * to `process.env.*` at compile time. So in tests we control configuration via
 * `process.env.VITE_*`, `process.env.PROD` and `process.env.DEV`.
 *
 * env.ts evaluates its validation at MODULE-LOAD time (the exported constants
 * AUTH_MODE / API_BASE_URL / ENTRA_TENANT_ID / REDIRECT_URI / LOGIN_SCOPES are
 * computed once on first import, and the production misconfiguration guard
 * throws during evaluation). Therefore every case sets process.env first, then
 * loads a FRESH copy of the module via jest.resetModules() + require(), so that
 * cases never leak module-level state into one another.
 *
 * jsdom defaults: window.location.origin === 'http://localhost',
 * window.location.hostname === 'localhost'.
 */

// The shape of the (compiled CJS) module namespace we get from require().
type EnvModule = typeof import('../../services/env');

const MODULE_PATH = '../../services/env';

// Snapshot of every process.env key env.ts touches, so we can restore it
// exactly after each test and avoid leaking into other suites.
const TRACKED_KEYS = [
  'VITE_AUTH_MODE',
  'VITE_API_URL',
  'VITE_ENTRA_CLIENT_ID',
  'VITE_ENTRA_TENANT_ID',
  'VITE_REDIRECT_URI',
  'PROD',
  'DEV',
] as const;

let savedEnv: Record<string, string | undefined>;

/**
 * Apply a partial env, deleting keys whose value is undefined so that the
 * code sees an actually-absent variable (not the string "undefined").
 */
function applyEnv(overrides: Partial<Record<(typeof TRACKED_KEYS)[number], string | undefined>>): void {
  for (const key of TRACKED_KEYS) {
    if (key in overrides) {
      const value = overrides[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/** Reset module cache and load a fresh, fully-evaluated copy of env.ts. */
function loadEnv(): EnvModule {
  let mod!: EnvModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require(MODULE_PATH) as EnvModule;
  });
  return mod;
}

/** Attempt to load env.ts, returning the thrown error (or undefined). */
function loadEnvExpectingThrow(): Error | undefined {
  let caught: Error | undefined;
  jest.isolateModules(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(MODULE_PATH);
    } catch (err) {
      caught = err as Error;
    }
  });
  return caught;
}

beforeEach(() => {
  savedEnv = {};
  for (const key of TRACKED_KEYS) {
    savedEnv[key] = process.env[key];
  }
  // Start each test from a clean, known-good baseline. setupTests.ts seeds
  // some of these globally; we make the baseline explicit and reset PROD/DEV.
  applyEnv({
    VITE_AUTH_MODE: 'stub',
    VITE_API_URL: 'http://localhost:4444/api/v1',
    VITE_ENTRA_CLIENT_ID: 'test-client-id',
    VITE_ENTRA_TENANT_ID: 'common',
    VITE_REDIRECT_URI: 'http://localhost:5173',
    PROD: undefined,
    DEV: 'true',
  });
});

afterEach(() => {
  // Restore the exact pre-test environment so other suites are unaffected.
  for (const key of TRACKED_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  jest.resetModules();
});

// ── getTenantId (via ENTRA_TENANT_ID) ────────────────────────────────
// The core security property: the tenant id flows into the MSAL authority
// URL, so only the well-known "magic" tenants or a 36-char GUID may pass.
describe('ENTRA_TENANT_ID allow-list (getTenantId)', () => {
  it('accepts a valid lowercase GUID tenant id', () => {
    applyEnv({ VITE_ENTRA_TENANT_ID: '12345678-1234-1234-1234-1234567890ab' });
    expect(loadEnv().ENTRA_TENANT_ID).toBe('12345678-1234-1234-1234-1234567890ab');
  });

  it('accepts a valid uppercase/mixed-case GUID tenant id', () => {
    applyEnv({ VITE_ENTRA_TENANT_ID: 'ABCDEF12-3456-7890-ABCD-EF1234567890' });
    expect(loadEnv().ENTRA_TENANT_ID).toBe('ABCDEF12-3456-7890-ABCD-EF1234567890');
  });

  it.each(['common', 'organizations', 'consumers'])(
    'accepts the well-known magic tenant %p',
    (magic) => {
      applyEnv({ VITE_ENTRA_TENANT_ID: magic });
      expect(loadEnv().ENTRA_TENANT_ID).toBe(magic);
    },
  );

  it('REJECTS an attacker-controlled hostname and falls back to "common"', () => {
    applyEnv({ VITE_ENTRA_TENANT_ID: 'evil.example.com' });
    expect(loadEnv().ENTRA_TENANT_ID).toBe('common');
  });

  it('REJECTS a path-traversal style value and falls back to "common"', () => {
    applyEnv({ VITE_ENTRA_TENANT_ID: 'common/../evil' });
    expect(loadEnv().ENTRA_TENANT_ID).toBe('common');
  });

  it('REJECTS a GUID with surrounding text (no full-string anchor bypass)', () => {
    // The pattern is anchored ^...$ — a valid GUID embedded in junk must fail.
    applyEnv({ VITE_ENTRA_TENANT_ID: 'x12345678-1234-1234-1234-1234567890abx' });
    expect(loadEnv().ENTRA_TENANT_ID).toBe('common');
  });

  it('REJECTS a magic tenant with a trailing newline (anchors are line-anchored only via ^$, but . excludes \\n)', () => {
    // Guards against the classic JS regex multiline `$` bypass where
    // "common\n@evil" would match an unanchored/multiline pattern.
    applyEnv({ VITE_ENTRA_TENANT_ID: 'common\nevil.example.com' });
    expect(loadEnv().ENTRA_TENANT_ID).toBe('common');
  });

  it('REJECTS a GUID of the wrong length', () => {
    applyEnv({ VITE_ENTRA_TENANT_ID: '12345678-1234-1234-1234-1234567890' }); // last group too short
    expect(loadEnv().ENTRA_TENANT_ID).toBe('common');
  });

  it('REJECTS an empty string and falls back to "common"', () => {
    applyEnv({ VITE_ENTRA_TENANT_ID: '' });
    expect(loadEnv().ENTRA_TENANT_ID).toBe('common');
  });

  it('REJECTS a missing value and falls back to "common"', () => {
    applyEnv({ VITE_ENTRA_TENANT_ID: undefined });
    expect(loadEnv().ENTRA_TENANT_ID).toBe('common');
  });
});

// ── getApiBaseUrl (via API_BASE_URL) ─────────────────────────────────
describe('API_BASE_URL HTTPS / localhost enforcement (getApiBaseUrl)', () => {
  it('allows http://localhost', () => {
    applyEnv({ VITE_API_URL: 'http://localhost:4444/api/v1' });
    expect(loadEnv().API_BASE_URL).toBe('http://localhost:4444/api/v1');
  });

  it('allows http://127.0.0.1', () => {
    applyEnv({ VITE_API_URL: 'http://127.0.0.1:4444/api/v1' });
    expect(loadEnv().API_BASE_URL).toBe('http://127.0.0.1:4444/api/v1');
  });

  it('REJECTS http://[::1] because URL hostname keeps the brackets but the allow-list stores "::1"', () => {
    // Documenting a real edge: the WHATWG URL API normalises the IPv6 host to
    // '[::1]' (with brackets), whereas LOCALHOST_NAMES holds the bare '::1'.
    // The two never match, so http://[::1] is treated as a non-localhost host
    // and rejected for not being HTTPS. (Not a security hole — it is stricter
    // than intended, not looser.)
    applyEnv({ VITE_API_URL: 'http://[::1]:4444/api/v1' });
    expect(loadEnvExpectingThrow()?.message).toBe(
      'VITE_API_URL must be HTTPS unless it targets localhost development.',
    );
  });

  it('REJECTS plain-http to a remote host (must be HTTPS)', () => {
    applyEnv({ VITE_API_URL: 'http://remote-host.example.com/api/v1' });
    expect(loadEnvExpectingThrow()?.message).toBe(
      'VITE_API_URL must be HTTPS unless it targets localhost development.',
    );
  });

  it('allows an HTTPS remote host', () => {
    applyEnv({ VITE_API_URL: 'https://api.example.com/api/v1' });
    expect(loadEnv().API_BASE_URL).toBe('https://api.example.com/api/v1');
  });

  it('trims trailing slashes from the configured URL', () => {
    applyEnv({ VITE_API_URL: 'https://api.example.com/api/v1///' });
    expect(loadEnv().API_BASE_URL).toBe('https://api.example.com/api/v1');
  });

  it('accepts a relative path (starts with "/") without protocol checks', () => {
    applyEnv({ VITE_API_URL: '/api/v1' });
    expect(loadEnv().API_BASE_URL).toBe('/api/v1');
  });

  it('falls back to the DEV default when unset and DEV is true', () => {
    applyEnv({ VITE_API_URL: undefined, DEV: 'true', PROD: undefined });
    expect(loadEnv().API_BASE_URL).toBe('http://localhost:4444/api/v1');
  });

  it('falls back to the PROD default (relative path) when unset and not DEV', () => {
    // PROD true also activates the redirect-origin guard, so use a redirect
    // that matches the jsdom window origin to isolate the API-URL behaviour.
    applyEnv({
      VITE_API_URL: undefined,
      DEV: undefined,
      PROD: 'true',
      VITE_REDIRECT_URI: 'http://localhost/callback',
    });
    expect(loadEnv().API_BASE_URL).toBe('/api/v1');
  });
});

// ── getRedirectUri (via REDIRECT_URI) ────────────────────────────────
describe('REDIRECT_URI HTTPS / localhost / origin enforcement (getRedirectUri)', () => {
  it('allows http://localhost (dev)', () => {
    applyEnv({ VITE_REDIRECT_URI: 'http://localhost:5173' });
    // URL.toString() normalises to include a trailing slash on a bare origin.
    expect(loadEnv().REDIRECT_URI).toBe('http://localhost:5173/');
  });

  it('allows http://127.0.0.1 (dev)', () => {
    applyEnv({ VITE_REDIRECT_URI: 'http://127.0.0.1:5173/' });
    expect(loadEnv().REDIRECT_URI).toBe('http://127.0.0.1:5173/');
  });

  it('REJECTS plain-http to a remote host', () => {
    applyEnv({ VITE_REDIRECT_URI: 'http://evil.example.com/callback' });
    expect(loadEnvExpectingThrow()?.message).toBe(
      'VITE_REDIRECT_URI must be HTTPS unless it targets localhost development.',
    );
  });

  it('REJECTS a non-HTTP(S) scheme such as javascript:', () => {
    // new URL('javascript:alert(1)', base) keeps the javascript: protocol.
    applyEnv({ VITE_REDIRECT_URI: 'javascript:alert(1)' });
    expect(loadEnvExpectingThrow()?.message).toBe(
      'VITE_REDIRECT_URI must use HTTP or HTTPS.',
    );
  });

  it('allows an HTTPS remote redirect URI when not in production', () => {
    applyEnv({ VITE_REDIRECT_URI: 'https://app.example.com/callback', PROD: undefined });
    expect(loadEnv().REDIRECT_URI).toBe('https://app.example.com/callback');
  });

  it('in PROD, REJECTS a redirect URI whose origin differs from the window origin', () => {
    // jsdom window origin is http://localhost; an https remote origin differs.
    applyEnv({ VITE_REDIRECT_URI: 'https://app.example.com/callback', PROD: 'true' });
    expect(loadEnvExpectingThrow()?.message).toBe(
      'VITE_REDIRECT_URI must match the application origin in production.',
    );
  });

  it('in PROD, ALLOWS a redirect URI matching the window origin', () => {
    // window origin is http://localhost; localhost http is permitted, and the
    // origin matches, so it passes even under the PROD origin check.
    applyEnv({ VITE_REDIRECT_URI: 'http://localhost/callback', PROD: 'true' });
    expect(loadEnv().REDIRECT_URI).toBe('http://localhost/callback');
  });

  it('falls back to the window origin default when unset', () => {
    applyEnv({ VITE_REDIRECT_URI: undefined });
    // DEFAULT_REDIRECT_URI = window.location.origin = 'http://localhost' → normalised with trailing slash.
    expect(loadEnv().REDIRECT_URI).toBe('http://localhost/');
  });
});

// ── AUTH_MODE / IS_STUB_AUTH_MODE ────────────────────────────────────
describe('AUTH_MODE and IS_STUB_AUTH_MODE', () => {
  it('defaults to "msal" for any value other than "stub"', () => {
    applyEnv({ VITE_AUTH_MODE: 'something-else' });
    expect(loadEnv().AUTH_MODE).toBe('msal');
  });

  it('is "stub" when VITE_AUTH_MODE === "stub"', () => {
    applyEnv({ VITE_AUTH_MODE: 'stub' });
    expect(loadEnv().AUTH_MODE).toBe('stub');
  });

  it('IS_STUB_AUTH_MODE is true in stub mode on localhost when not in production', () => {
    applyEnv({ VITE_AUTH_MODE: 'stub', PROD: undefined });
    expect(loadEnv().IS_STUB_AUTH_MODE).toBe(true);
  });

  it('IS_STUB_AUTH_MODE is false in production even on localhost in stub mode', () => {
    // Use a localhost redirect so the PROD origin guard does not throw before
    // we can read IS_STUB_AUTH_MODE.
    applyEnv({
      VITE_AUTH_MODE: 'stub',
      PROD: 'true',
      VITE_REDIRECT_URI: 'http://localhost/callback',
    });
    expect(loadEnv().IS_STUB_AUTH_MODE).toBe(false);
  });

  it('IS_STUB_AUTH_MODE is false when not in stub mode', () => {
    applyEnv({ VITE_AUTH_MODE: 'msal' });
    expect(loadEnv().IS_STUB_AUTH_MODE).toBe(false);
  });
});

// ── LOGIN_SCOPES + production misconfiguration guard ─────────────────
describe('LOGIN_SCOPES and production misconfiguration guard', () => {
  it('builds the access_as_user scope from the client id', () => {
    applyEnv({ VITE_ENTRA_CLIENT_ID: 'abc-123' });
    expect(loadEnv().LOGIN_SCOPES).toEqual(['api://abc-123/access_as_user']);
  });

  it('produces empty scopes when the client id is unset', () => {
    applyEnv({ VITE_ENTRA_CLIENT_ID: '', PROD: undefined });
    expect(loadEnv().LOGIN_SCOPES).toEqual([]);
  });

  it('THROWS on production builds when the client id is missing (empty scopes)', () => {
    // PROD true, msal mode (not stub) so IS_STUB_AUTH_MODE is false, no client id.
    applyEnv({
      VITE_ENTRA_CLIENT_ID: '',
      VITE_AUTH_MODE: 'msal',
      PROD: 'true',
      DEV: undefined,
      VITE_REDIRECT_URI: 'http://localhost/callback', // keep redirect guard happy
      VITE_API_URL: '/api/v1', // relative path skips HTTPS check
    });
    expect(loadEnvExpectingThrow()?.message).toBe(
      'VITE_ENTRA_CLIENT_ID must be set in production (LOGIN_SCOPES is empty).',
    );
  });

  it('does NOT throw in production when a client id is present', () => {
    applyEnv({
      VITE_ENTRA_CLIENT_ID: 'real-client-id',
      VITE_AUTH_MODE: 'msal',
      PROD: 'true',
      DEV: undefined,
      VITE_REDIRECT_URI: 'http://localhost/callback',
      VITE_API_URL: '/api/v1',
    });
    expect(loadEnvExpectingThrow()).toBeUndefined();
  });

  it('does NOT throw when scopes are empty but the build is NOT production', () => {
    applyEnv({ VITE_ENTRA_CLIENT_ID: '', VITE_AUTH_MODE: 'msal', PROD: undefined });
    expect(loadEnvExpectingThrow()).toBeUndefined();
  });
});
