import type { Config } from 'jest';

// Pin the timezone before workers fork so any Date-based assertion (e.g. csv date
// formatting) is deterministic across machines/CI rather than host-locale dependent.
process.env.TZ = 'UTC';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Integration tests (*.integration.test.ts) require a live MySQL and run only
  // via `npm run test:integration` (jest.integration.config.ts), so the default
  // unit run — `npm test`, `npm run test:coverage`, and the CI unit-tests job —
  // never attempts a DB connection.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
    '!src/server.ts',
  ],
  // Ratchet set a few points below current unit-test coverage so it can only go up.
  // NB: Jest's "global" floor applies only to files NOT matched by a path-specific
  // key below — so once utils/middleware/services are carved out, "global" measures
  // the remaining controllers/models/routes/config/app, which are largely covered by
  // the integration suite (run separately) rather than unit tests. That residual sits
  // ~33%. The per-directory floors lock in the high coverage of the security/money-
  // handling code so a regression there fails CI immediately. Raise these over time.
  // Last calibrated against actual: residual-global ~33%, utils ~89%, middleware ~75%,
  // services ~70% (whole-suite coverage is ~49%).
  coverageThreshold: {
    global: { statements: 30, branches: 27, functions: 31, lines: 29 },
    './src/utils/': { statements: 87, branches: 80, functions: 95, lines: 87 },
    './src/middleware/': { statements: 72, branches: 71, functions: 66, lines: 72 },
    './src/services/': { statements: 68, branches: 50, functions: 54, lines: 68 },
  },
};

export default config;
