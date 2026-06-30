// Client-side store for the "acting as" role used by Entra role switching. A
// user who holds multiple app roles can act as a lower one; the desired role is
// kept here and attached to every request as `X-Active-Role` (see api.ts). The
// server is the source of truth — it validates the header against the roles the
// user actually holds and can only narrow, never escalate. Kept in sessionStorage
// (mirroring demoAuth/stubAuth) so it clears when the tab closes and never bleeds
// across tabs.
import { Role } from '../types';

const ACTIVE_ROLE_KEY = 'active_role';

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
    // Ignore unavailable storage; the choice simply won't persist across reloads.
  }
}

function removeItem(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

// Validate against the Role union so a tampered/garbage value can never be sent
// (the server would reject it anyway, but we don't even attach it).
function isRole(value: string | null): value is Role {
  return value === Role.EMPLOYEE || value === Role.MANAGER || value === Role.ADMIN;
}

export function getStoredActiveRole(): Role | null {
  const value = getItem(ACTIVE_ROLE_KEY);
  return isRole(value) ? value : null;
}

export function setStoredActiveRole(role: Role): void {
  setItem(ACTIVE_ROLE_KEY, role);
}

export function clearStoredActiveRole(): void {
  removeItem(ACTIVE_ROLE_KEY);
}
