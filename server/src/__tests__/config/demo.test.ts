import {
  isDemoEnabled,
  getDemoSecret,
  getDemoTtlSeconds,
  getDemoMaxActive,
} from '../../config/demo';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ENABLE_DEMO;
  delete process.env.DEMO_JWT_SECRET;
  delete process.env.DEMO_SESSION_TTL_SECONDS;
  delete process.env.DEMO_MAX_ACTIVE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('isDemoEnabled', () => {
  it('is off unless ENABLE_DEMO=true AND a secret is set', () => {
    expect(isDemoEnabled()).toBe(false);

    process.env.ENABLE_DEMO = 'true';
    expect(isDemoEnabled()).toBe(false); // no secret yet

    process.env.DEMO_JWT_SECRET = 'a'.repeat(32);
    expect(isDemoEnabled()).toBe(true);

    process.env.ENABLE_DEMO = 'false';
    expect(isDemoEnabled()).toBe(false);
  });

  it('exposes the configured secret', () => {
    process.env.DEMO_JWT_SECRET = 'super-secret';
    expect(getDemoSecret()).toBe('super-secret');
  });
});

describe('getDemoTtlSeconds', () => {
  it('defaults to 2 hours', () => {
    expect(getDemoTtlSeconds()).toBe(2 * 60 * 60);
  });

  it('honors a valid positive override', () => {
    process.env.DEMO_SESSION_TTL_SECONDS = '600';
    expect(getDemoTtlSeconds()).toBe(600);
  });

  it.each(['0', '-1', 'abc', ''])(
    'falls back to the default for the invalid value %p (never a dead-on-arrival TTL)',
    (value) => {
      process.env.DEMO_SESSION_TTL_SECONDS = value;
      expect(getDemoTtlSeconds()).toBe(2 * 60 * 60);
    },
  );
});

describe('getDemoMaxActive', () => {
  it('defaults to 50', () => {
    expect(getDemoMaxActive()).toBe(50);
  });

  it('honors a valid positive override', () => {
    process.env.DEMO_MAX_ACTIVE = '5';
    expect(getDemoMaxActive()).toBe(5);
  });

  it.each(['0', '-3', 'nope', ''])(
    'falls back to the default for the invalid value %p (never a permanently-at-capacity cap)',
    (value) => {
      process.env.DEMO_MAX_ACTIVE = value;
      expect(getDemoMaxActive()).toBe(50);
    },
  );
});
