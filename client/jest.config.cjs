/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|svg|webp)$': '<rootDir>/src/__tests__/__mocks__/fileMock.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
        astTransformers: {
          before: [
            {
              path: 'src/__tests__/helpers/importMetaTransformer.ts',
              name: 'importMetaTransformer',
            },
          ],
        },
        diagnostics: {
          // 1343: "import.meta meta-property only allowed when module is es2020/esnext…".
          // App code uses Vite's import.meta.env; the importMetaTransformer rewrites it to
          // process.env at emit time, but the checker still flags the syntax under
          // module:commonjs, so this one stays suppressed. ImportMeta.env itself is typed
          // via "vite/client" in tsconfig.test.json, so we deliberately do NOT suppress
          // 2339 ("property does not exist") — that guard catches real typos in tests.
          ignoreCodes: [1343],
        },
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setupTests.ts'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
    '!src/main.tsx',
    '!src/vite-env.d.ts',
  ],
  // Conservative ratchet just below current coverage. The global floor is low
  // because most redesign UI (components/, pages/) is not yet unit-tested; the
  // per-directory floor protects the security-sensitive services/ layer
  // (env tenant/HTTPS allow-listing, auth) from regressing. Raise over time.
  coverageThreshold: {
    global: { statements: 5, branches: 2, functions: 5, lines: 5 },
    './src/services/': { statements: 76, branches: 74, functions: 76, lines: 76 },
  },
};

module.exports = config;
