import '@testing-library/jest-dom';

// NB: the timezone is pinned to UTC in jest.config.cjs (before workers fork) so
// date-only formatting is deterministic across machines. Setting it here instead
// would be too late — V8 caches the local zone before setupTests runs.

// react-router-dom v7 uses the WHATWG URL API which requires TextEncoder/TextDecoder
// jsdom doesn't include them — pull them from Node's built-in util module.
import { TextEncoder, TextDecoder } from 'util';
Object.assign(global, { TextEncoder, TextDecoder });

// AST transformer converts import.meta.env.X → process.env.X at compile time,
// so we set the VITE_* variables here for tests to pick them up.
process.env.VITE_AUTH_MODE = 'stub';
process.env.VITE_API_URL = 'http://localhost:4444/api/v1';
process.env.VITE_ENTRA_CLIENT_ID = 'test-client-id';
process.env.VITE_ENTRA_TENANT_ID = 'test-tenant-id';
process.env.VITE_REDIRECT_URI = 'http://localhost:5173';

// jsdom's environment doesn't expose structuredClone (a browser/Node global).
// dagre — used by the org-chart layout — calls it, so polyfill with a structural
// JSON clone, which is sufficient for the plain-data graph labels dagre clones.
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (<T>(value: T): T =>
    JSON.parse(JSON.stringify(value))) as typeof structuredClone;
}

// jsdom does not implement window.matchMedia — mock it so components that
// call matchMedia (e.g. responsive hooks, MUI) don't throw. Defaults to the
// desktop match; see __tests__/helpers/matchMedia.ts to force the mobile branch.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }),
});

// Fail a test if it logs an unexpected console.error / console.warn. React's
// act() warnings, "can't update state on an unmounted component", invalid-prop
// and missing-key warnings are the single most common signal of a real
// async/effect bug — without this guard they print to the console and are
// silently ignored, so a test can "pass" while leaking them. A test that
// LEGITIMATELY expects a warning must assert it by installing its own
// `jest.spyOn(console, 'error').mockImplementation(...)`; those calls go to the
// test's own spy and never reach the guard below.
const IGNORED_CONSOLE: RegExp[] = [
  // jsdom logs this whenever window.location.assign()/navigation is exercised
  // (the demo-session 401 → /login redirect tests deliberately trigger it).
  /Not implemented: navigation/,
];

let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error');
  consoleWarnSpy = jest.spyOn(console, 'warn');
});

afterEach(() => {
  const offenders = [...consoleErrorSpy.mock.calls, ...consoleWarnSpy.mock.calls].filter(
    (args) => !IGNORED_CONSOLE.some((re) => re.test(String(args[0]))),
  );
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  if (offenders.length > 0) {
    throw new Error(
      `Test logged ${offenders.length} unexpected console.error/warn call(s). ` +
        `If expected, spy on console in the test to assert it:\n` +
        offenders.map((a) => '  • ' + String(a[0])).join('\n'),
    );
  }
});
