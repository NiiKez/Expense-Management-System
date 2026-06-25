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
  // key below. With controllers now carved out into their own floor, "global"
  // measures the remaining models/routes/config/app layer, which is exercised by the
  // integration suite (run separately) rather than unit tests and so sits low (~20%).
  // The per-directory floors lock in the high unit coverage of the security/money-
  // handling code (controllers, middleware, services, utils) so a regression there
  // fails CI immediately — a fully-untested file in one of those dirs can no longer
  // hide behind well-covered siblings. Raise these over time.
  // Last calibrated against actual: controllers ~96/83/90/96, utils ~98/93/100/98,
  // middleware ~87/83/87/88, services ~89/81/89/90, residual-global ~18% (whole-suite
  // unit coverage is ~72%).
  coverageThreshold: {
    global: { statements: 16, branches: 10, functions: 13, lines: 17 },
    './src/controllers/': { statements: 90, branches: 78, functions: 84, lines: 90 },
    './src/utils/': { statements: 94, branches: 89, functions: 98, lines: 94 },
    './src/middleware/': { statements: 83, branches: 78, functions: 82, lines: 83 },
    './src/services/': { statements: 84, branches: 75, functions: 84, lines: 85 },
  },
};

export default config;
