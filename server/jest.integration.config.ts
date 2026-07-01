import type { Config } from 'jest';

// Pin the timezone before workers fork so any Date-based assertion is deterministic
// across machines/CI. This matters most for the demo-session lifecycle: expiry
// compares the Node process clock (Date.now) against the MySQL-stored
// `demo_expires_at`, so a host TZ other than UTC could skew the boundary. Mirrors
// the same pin in jest.config.ts (unit runner).
process.env.TZ = 'UTC';

// Integration tests exercise the full HTTP stack against a live MySQL instance.
// They run ONLY in the Docker test stack (docker/docker-compose.test.yml) or via
// `npm run test:integration` with DB_* env vars pointed at a disposable database.
//
// This config is intentionally self-contained (it does NOT import jest.config.ts):
// importing the base default-export and spreading it is fragile across ts-node
// interop settings — under the Docker runner the import resolved to { default: … },
// so the spread silently dropped `preset`/`roots` and jest found no tests.
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/integration/**/*.integration.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // The first beforeAll opens the pool and connects to a freshly-started MySQL.
  // Under the Docker runner a cold connect can exceed Jest's 5s default and flake;
  // give DB-backed tests a generous ceiling.
  testTimeout: 30_000,
  // Fail the whole run before any pool is opened if DB_NAME is not a disposable
  // test database — the destructive setup helpers would otherwise wipe it.
  globalSetup: '<rootDir>/src/__tests__/integration/globalSetup.ts',
};

export default config;
