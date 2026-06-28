// Client-side store for the public demo session token. Separate from the
// dev-only stub path (which is disabled in production builds): the demo token is
// a real, server-signed JWT and works in production. Kept in sessionStorage so
// it clears when the tab closes.
const DEMO_TOKEN_KEY = 'demo_token';

function getItem(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore unavailable storage; the demo simply won't persist across reloads.
  }
}

function removeItem(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

export function getStoredDemoToken(): string | null {
  return getItem(DEMO_TOKEN_KEY);
}

export function storeDemoToken(token: string): void {
  setItem(DEMO_TOKEN_KEY, token);
}

export function clearDemoToken(): void {
  removeItem(DEMO_TOKEN_KEY);
}

export function isDemoSession(): boolean {
  return !!getStoredDemoToken();
}
