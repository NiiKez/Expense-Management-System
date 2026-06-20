const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4444/api/v1';
const DEFAULT_PROD_API_BASE_URL = '/api/v1';
const DEFAULT_REDIRECT_URI = typeof window === 'undefined' ? 'http://localhost:5173' : window.location.origin;
const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '::1']);
// Strict: only the well-known Entra "magic" tenants or a 36-char GUID. Why:
// the previous catch-all alternation accepted attacker-controlled hostnames
// like `evil.example.com`, which would have ended up in the MSAL authority URL.
const SAFE_TENANT_PATTERN = /^(common|organizations|consumers|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export type AuthMode = 'msal' | 'stub';

function getAuthMode(value: unknown): AuthMode {
  return value === 'stub' ? 'stub' : 'msal';
}

function getTenantId(value: unknown) {
  if (typeof value !== 'string' || !SAFE_TENANT_PATTERN.test(value)) {
    return 'common';
  }

  return value;
}

function getWindowOrigin(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin;
}

function isLocalhostName(hostname: string): boolean {
  return LOCALHOST_NAMES.has(hostname);
}

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  return isLocalhostName(window.location.hostname);
}

function getApiBaseUrl(value: unknown): string {
  const configuredValue = typeof value === 'string' && value.trim()
    ? value.trim()
    : (import.meta.env.DEV ? DEFAULT_DEV_API_BASE_URL : DEFAULT_PROD_API_BASE_URL);

  if (configuredValue.startsWith('/')) {
    return configuredValue;
  }

  const url = new URL(configuredValue);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhostName(url.hostname))) {
    throw new Error('VITE_API_URL must be HTTPS unless it targets localhost development.');
  }

  return configuredValue.replace(/\/+$/, '');
}

function getRedirectUri(value: unknown): string {
  const configuredValue = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_REDIRECT_URI;
  const url = new URL(configuredValue, DEFAULT_REDIRECT_URI);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('VITE_REDIRECT_URI must use HTTP or HTTPS.');
  }

  if (url.protocol === 'http:' && !isLocalhostName(url.hostname)) {
    throw new Error('VITE_REDIRECT_URI must be HTTPS unless it targets localhost development.');
  }

  const windowOrigin = getWindowOrigin();
  if (import.meta.env.PROD && windowOrigin && url.origin !== windowOrigin) {
    throw new Error('VITE_REDIRECT_URI must match the application origin in production.');
  }

  return url.toString();
}

export const AUTH_MODE = getAuthMode(import.meta.env.VITE_AUTH_MODE);
export const IS_STUB_AUTH_MODE = AUTH_MODE === 'stub' && !import.meta.env.PROD && isLocalhost();
export const API_BASE_URL = getApiBaseUrl(import.meta.env.VITE_API_URL);
export const ENTRA_CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID || '';
export const ENTRA_TENANT_ID = getTenantId(import.meta.env.VITE_ENTRA_TENANT_ID);
export const REDIRECT_URI = getRedirectUri(import.meta.env.VITE_REDIRECT_URI);
export const LOGIN_SCOPES = ENTRA_CLIENT_ID ? [`api://${ENTRA_CLIENT_ID}/access_as_user`] : [];

// Fail loud on a misconfigured production build: empty scopes silently produce
// a no-scope login that returns no usable access token.
if (import.meta.env.PROD && !IS_STUB_AUTH_MODE && LOGIN_SCOPES.length === 0) {
  throw new Error('VITE_ENTRA_CLIENT_ID must be set in production (LOGIN_SCOPES is empty).');
}
