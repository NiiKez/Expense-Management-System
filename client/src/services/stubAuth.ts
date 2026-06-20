import { STUB_USERS } from '../context/stubUsers';
import type { User } from '../types';

const STUB_USER_ID_KEY = 'stub_user_id';
const LEGACY_STUB_USER_KEY = 'stub_user';

function getSessionItem(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSessionItem(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore unavailable storage; stub auth will behave as a non-persistent session.
  }
}

function removeSessionItem(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

function findStubUserById(value: unknown): User | null {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return STUB_USERS.find((user) => user.id === id) ?? null;
}

export function getStoredStubUser(): User | null {
  const storedId = getSessionItem(STUB_USER_ID_KEY);
  if (storedId) {
    const user = findStubUserById(storedId);
    if (user) return user;
  }

  const legacyValue = getSessionItem(LEGACY_STUB_USER_KEY);
  if (!legacyValue) {
    if (storedId) removeSessionItem(STUB_USER_ID_KEY);
    return null;
  }

  try {
    const legacyUser = findStubUserById((JSON.parse(legacyValue) as { id?: unknown }).id);
    if (legacyUser) {
      setStoredStubUser(legacyUser);
      return legacyUser;
    }
  } catch {
    // Invalid legacy data is cleared below.
  }

  clearStoredStubUser();
  return null;
}

export function setStoredStubUser(user: User): User | null {
  const stubUser = findStubUserById(user.id);
  if (!stubUser) {
    clearStoredStubUser();
    return null;
  }

  setSessionItem(STUB_USER_ID_KEY, String(stubUser.id));
  removeSessionItem(LEGACY_STUB_USER_KEY);
  return stubUser;
}

export function clearStoredStubUser() {
  removeSessionItem(STUB_USER_ID_KEY);
  removeSessionItem(LEGACY_STUB_USER_KEY);
}

export function getStoredStubUserId(): number | null {
  return getStoredStubUser()?.id ?? null;
}
