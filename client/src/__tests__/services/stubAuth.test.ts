// stubAuth persists only a stub USER ID (never a full user object), then re-resolves
// the canonical user from the trusted STUB_USERS table on read. That indirection is the
// tamper guard: a hand-edited display_name/role in sessionStorage can never take effect
// because only the id is honoured and the rest comes from code. These tests exercise the
// unknown-id, garbage-legacy, and migration branches that the interceptor/context tests
// don't reach directly. No mocking needed: sessionStorage is real (jsdom) and STUB_USERS
// is the real table — no import.meta/env, so this file imports the module as-is.
import { Role } from '../../types';
import { STUB_USERS } from '../../context/stubUsers';
import {
  clearStoredStubUser,
  getStoredStubUser,
  getStoredStubUserId,
  setStoredStubUser,
} from '../../services/stubAuth';

const STUB_USER_ID_KEY = 'stub_user_id';
const LEGACY_STUB_USER_KEY = 'stub_user';

// Two concrete rows from the trusted table, used to assert canonical values win.
const ALICE_ADMIN = STUB_USERS.find((u) => u.id === 1)!; // Alice Admin / ADMIN
const BOB_MANAGER = STUB_USERS.find((u) => u.id === 2)!; // Bob Manager / MANAGER

describe('stubAuth', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('setStoredStubUser', () => {
    it('stores only the id for a known user and returns the CANONICAL row (ignoring tampered fields)', () => {
      // Caller-supplied object is untrusted: elevate the role + rename to prove the
      // returned/stored identity comes from STUB_USERS by id, not from the input.
      const tampered = { ...BOB_MANAGER, display_name: 'Hacker', role: Role.ADMIN };

      const result = setStoredStubUser(tampered);

      expect(result).toEqual(BOB_MANAGER);
      expect(result?.role).toBe(Role.MANAGER); // NOT the tampered ADMIN
      expect(result?.display_name).toBe('Bob Manager'); // NOT 'Hacker'
      // Only the id is persisted; no full-object legacy key is written.
      expect(sessionStorage.getItem(STUB_USER_ID_KEY)).toBe('2');
      expect(sessionStorage.getItem(LEGACY_STUB_USER_KEY)).toBeNull();
    });

    it('clears any stored session and returns null for an unknown id', () => {
      // Pre-seed a valid session so we can prove the failed set actively clears it.
      setStoredStubUser(ALICE_ADMIN);
      expect(sessionStorage.getItem(STUB_USER_ID_KEY)).toBe('1');

      const result = setStoredStubUser({ ...ALICE_ADMIN, id: 999 });

      expect(result).toBeNull();
      expect(sessionStorage.getItem(STUB_USER_ID_KEY)).toBeNull();
      expect(sessionStorage.getItem(LEGACY_STUB_USER_KEY)).toBeNull();
    });

    it('rejects a non-positive / non-integer id as unknown', () => {
      // findStubUserById guards Number.isInteger(id) && id > 0, so 0, negatives and
      // fractionals never match a row.
      expect(setStoredStubUser({ ...ALICE_ADMIN, id: 0 })).toBeNull();
      expect(setStoredStubUser({ ...ALICE_ADMIN, id: -1 })).toBeNull();
      expect(setStoredStubUser({ ...ALICE_ADMIN, id: 1.5 })).toBeNull();
    });
  });

  describe('getStoredStubUser', () => {
    it('round-trips a set user back to the canonical row', () => {
      setStoredStubUser(ALICE_ADMIN);

      expect(getStoredStubUser()).toEqual(ALICE_ADMIN);
    });

    it('returns null and evicts an unknown stored id (no legacy value present)', () => {
      sessionStorage.setItem(STUB_USER_ID_KEY, '999');

      expect(getStoredStubUser()).toBeNull();
      // The stale id key is removed so it can't linger and be retried each read.
      expect(sessionStorage.getItem(STUB_USER_ID_KEY)).toBeNull();
    });

    it('returns null when nothing is stored', () => {
      expect(getStoredStubUser()).toBeNull();
    });

    it('migrates a valid legacy stub_user object to id-only storage', () => {
      // Legacy shape: the whole user object under `stub_user`. It's resolved by id to
      // the canonical row, then rewritten as id-only and the legacy key dropped.
      sessionStorage.setItem(
        LEGACY_STUB_USER_KEY,
        JSON.stringify({ ...BOB_MANAGER, display_name: 'Stale Name', role: Role.ADMIN }),
      );

      const result = getStoredStubUser();

      expect(result).toEqual(BOB_MANAGER);
      expect(result?.role).toBe(Role.MANAGER); // canonical, not the legacy ADMIN
      expect(sessionStorage.getItem(STUB_USER_ID_KEY)).toBe('2');
      expect(sessionStorage.getItem(LEGACY_STUB_USER_KEY)).toBeNull();
    });

    it('clears a legacy value containing garbage (non-JSON) and returns null', () => {
      sessionStorage.setItem(LEGACY_STUB_USER_KEY, '{not valid json');

      expect(getStoredStubUser()).toBeNull();
      expect(sessionStorage.getItem(LEGACY_STUB_USER_KEY)).toBeNull();
    });

    it('clears a legacy value whose id is unknown and returns null', () => {
      sessionStorage.setItem(LEGACY_STUB_USER_KEY, JSON.stringify({ id: 999 }));

      expect(getStoredStubUser()).toBeNull();
      expect(sessionStorage.getItem(LEGACY_STUB_USER_KEY)).toBeNull();
    });

    it('recovers via a valid legacy value when the id key holds an unknown id', () => {
      // Both keys set: the id key is stale/unknown, the legacy key is valid. The legacy
      // path resolves and repairs storage to the correct id-only form.
      sessionStorage.setItem(STUB_USER_ID_KEY, '999');
      sessionStorage.setItem(LEGACY_STUB_USER_KEY, JSON.stringify({ id: 2 }));

      const result = getStoredStubUser();

      expect(result).toEqual(BOB_MANAGER);
      expect(sessionStorage.getItem(STUB_USER_ID_KEY)).toBe('2');
      expect(sessionStorage.getItem(LEGACY_STUB_USER_KEY)).toBeNull();
    });
  });

  describe('getStoredStubUserId', () => {
    it('returns the numeric id for a stored known user', () => {
      setStoredStubUser(BOB_MANAGER);

      expect(getStoredStubUserId()).toBe(2);
    });

    it('returns null when nothing valid is stored', () => {
      expect(getStoredStubUserId()).toBeNull();
    });
  });

  describe('clearStoredStubUser', () => {
    it('removes both the id and legacy keys', () => {
      sessionStorage.setItem(STUB_USER_ID_KEY, '1');
      sessionStorage.setItem(LEGACY_STUB_USER_KEY, JSON.stringify(ALICE_ADMIN));

      clearStoredStubUser();

      expect(sessionStorage.getItem(STUB_USER_ID_KEY)).toBeNull();
      expect(sessionStorage.getItem(LEGACY_STUB_USER_KEY)).toBeNull();
    });
  });
});
