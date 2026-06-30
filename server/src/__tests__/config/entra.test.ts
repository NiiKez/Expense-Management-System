type EntraConfig = typeof import('../../config/entra').entraConfig;

const ENV_KEYS = ['ENTRA_CLIENT_ID', 'ENTRA_TENANT_ID', 'ENTRA_TOKEN_AUDIENCE'] as const;
type EnvKey = (typeof ENV_KEYS)[number];

describe('entraConfig', () => {
  const saved: Partial<Record<EnvKey, string | undefined>> = {};

  beforeAll(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.resetModules();
  });

  function loadEntra(env: Partial<Record<EnvKey, string>>): EntraConfig {
    jest.resetModules();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('../../config/entra') as typeof import('../../config/entra')).entraConfig;
  }

  it('builds default v1 + v2 audiences from the client id', () => {
    const cfg = loadEntra({ ENTRA_CLIENT_ID: 'client-abc' });
    expect(cfg.audiences).toEqual(['api://client-abc', 'client-abc']);
  });

  it('returns an empty audience list when the client id is unset (fail-closed)', () => {
    // An empty-string audience would be a matchable value to jsonwebtoken; the
    // filter must drop it so a misconfigured app rejects every token instead of
    // accepting an empty audience.
    const cfg = loadEntra({});
    expect(cfg.audiences).toEqual([]);
  });

  it('parses, trims, and drops empties from an explicit ENTRA_TOKEN_AUDIENCE', () => {
    const cfg = loadEntra({ ENTRA_CLIENT_ID: 'client-abc', ENTRA_TOKEN_AUDIENCE: 'aud-a, aud-b ,' });
    expect(cfg.audiences).toEqual(['aud-a', 'aud-b']);
  });

  it('composes authority, jwksUri, and both v1/v2 issuers from the tenant id', () => {
    const cfg = loadEntra({ ENTRA_TENANT_ID: 'tenant-xyz' });
    expect(cfg.authority).toBe('https://login.microsoftonline.com/tenant-xyz');
    expect(cfg.jwksUri).toBe('https://login.microsoftonline.com/tenant-xyz/discovery/v2.0/keys');
    expect(cfg.issuers).toEqual([
      'https://sts.windows.net/tenant-xyz/',
      'https://login.microsoftonline.com/tenant-xyz/v2.0',
    ]);
  });
});
