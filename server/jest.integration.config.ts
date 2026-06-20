import type { Config } from 'jest';

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
};

export default config;
