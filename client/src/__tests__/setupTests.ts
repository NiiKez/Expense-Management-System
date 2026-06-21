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

// jsdom does not implement window.matchMedia — mock it so components that
// call matchMedia (e.g. responsive hooks, MUI) don't throw.
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
