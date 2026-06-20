import type { Config } from 'jest';

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
  // The global floor is modest because models/ and routes/ are covered by the
  // integration suite (which runs separately), not by unit tests. The per-directory
  // floors lock in the high coverage of the security/money-handling utilities so a
  // regression there fails CI immediately. Raise these over time.
  coverageThreshold: {
    global: { statements: 35, branches: 30, functions: 34, lines: 35 },
    './src/utils/': { statements: 82, branches: 72, functions: 88, lines: 82 },
  },
};

export default config;
