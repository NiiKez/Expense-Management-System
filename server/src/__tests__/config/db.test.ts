import { assertDbPasswordConfigured, resolveDbSsl } from '../../config/db';

// These helpers are pure (env passed in), so we can exercise the production
// branches without NODE_ENV=test short-circuiting them and without opening a
// real DB connection.

describe('assertDbPasswordConfigured', () => {
  it('is a no-op in the test environment', () => {
    expect(() => assertDbPasswordConfigured({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('throws when DB_PASSWORD is missing outside test', () => {
    expect(() => assertDbPasswordConfigured({ NODE_ENV: 'production' } as NodeJS.ProcessEnv))
      .toThrow(/DB_PASSWORD is required/);
  });

  it('throws when DB_PASSWORD is the empty string', () => {
    expect(() => assertDbPasswordConfigured({ NODE_ENV: 'production', DB_PASSWORD: '' } as NodeJS.ProcessEnv))
      .toThrow(/DB_PASSWORD is required/);
  });

  it('throws when DB_PASSWORD is whitespace only (the gap the old check missed)', () => {
    expect(() => assertDbPasswordConfigured({ NODE_ENV: 'production', DB_PASSWORD: '   ' } as NodeJS.ProcessEnv))
      .toThrow(/DB_PASSWORD is required/);
  });

  it('accepts a real password outside test', () => {
    expect(() => assertDbPasswordConfigured({ NODE_ENV: 'production', DB_PASSWORD: 's3cret' } as NodeJS.ProcessEnv))
      .not.toThrow();
  });
});

describe('resolveDbSsl', () => {
  it('returns undefined (TLS off) by default', () => {
    expect(resolveDbSsl({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('returns undefined when DB_SSL is any value other than "true"', () => {
    expect(resolveDbSsl({ DB_SSL: '1' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveDbSsl({ DB_SSL: 'false' } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('enables TLS with certificate verification when DB_SSL=true', () => {
    expect(resolveDbSsl({ DB_SSL: 'true' } as NodeJS.ProcessEnv)).toEqual({ rejectUnauthorized: true });
  });

  it('allows disabling cert verification only via explicit opt-out', () => {
    expect(resolveDbSsl({ DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false' } as NodeJS.ProcessEnv))
      .toEqual({ rejectUnauthorized: false });
  });

  it('keeps verification on for any non-"false" opt-out value', () => {
    expect(resolveDbSsl({ DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'no' } as NodeJS.ProcessEnv))
      .toEqual({ rejectUnauthorized: true });
  });
});
