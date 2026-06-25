// Pin the timezone before Jest forks its workers (they inherit this env at spawn,
// so V8 reads TZ=UTC at their startup). Setting it later, e.g. in setupTests, is
// too late — V8 has already cached the local zone. Without this, date-only
// formatting in lib/format.test.ts rolls back a day west of UTC and flakes by host.
process.env.TZ = 'UTC';

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
          // GOTCHA — coverage of files NO test imports. `ignoreCodes` is only honoured on
          // ts-jest's SYNC path (`process`), which is what jest-runtime uses to `require`
          // a file a test imports: it keeps only the emitted `.code` and discards
          // diagnostics, so the 1343 above is moot there. But coverage for *uncovered*
          // collectCoverageFrom files is gathered in a worker via @jest/transform's
          // `transformSourceAsync`, which routes to ts-jest's ASYNC `processAsync` — and
          // that path RE-THROWS every returned diagnostic WITHOUT consulting `ignoreCodes`.
          // So a Vite-idiom file no test imports (e.g. services/auth.ts, whose only
          // executable line is an `import.meta.env.PROD` guard) throws 1343, Jest prints
          // "Failed to collect coverage from …" and silently DROPS it from the report —
          // letting it slip under the ./src/services/ 90% gate below. `exclude` tells
          // ts-jest to skip type diagnostics for these import.meta boundary files so the
          // coverage worker can instrument them; the importMetaTransformer still rewrites
          // import.meta→process.env at emit, and `tsc -b` still type-checks them at build.
          // NB: any NEW source file that reads `import.meta` must be added here, or its
          // coverage will be silently dropped the moment no test imports it.
          exclude: ['**/src/services/auth.ts', '**/src/services/env.ts'],
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
  // Ratchet just below current coverage so it can only go up. NB: Jest's "global"
  // floor applies only to files NOT matched by the services/ key below, so it measures
  // components/pages/etc. (services is carved out at a much higher floor). A few points
  // of buffer keeps a tiny change from flaking the gate. The per-directory floor
  // protects the security-sensitive services/ layer (env tenant/HTTPS allow-listing,
  // the MSAL bearer-token + 401-reauth interceptors) from regressing. Raise over time.
  // Last calibrated against actual: whole-suite ~65%, services ~92%.
  coverageThreshold: {
    global: { statements: 59, branches: 49, functions: 52, lines: 61 },
    './src/services/': { statements: 90, branches: 90, functions: 92, lines: 90 },
  },
};

module.exports = config;
