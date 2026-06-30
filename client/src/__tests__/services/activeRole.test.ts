import {
  getStoredActiveRole,
  setStoredActiveRole,
  clearStoredActiveRole,
} from '../../services/activeRole';
import { Role } from '../../types';

describe('services/activeRole', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it('returns null when nothing is stored', () => {
    expect(getStoredActiveRole()).toBeNull();
  });

  it('stores, reads back and clears a valid role under the active_role key', () => {
    setStoredActiveRole(Role.MANAGER);

    expect(getStoredActiveRole()).toBe(Role.MANAGER);
    expect(sessionStorage.getItem('active_role')).toBe('MANAGER');

    clearStoredActiveRole();

    expect(getStoredActiveRole()).toBeNull();
    expect(sessionStorage.getItem('active_role')).toBeNull();
  });

  it('accepts every member of the Role union', () => {
    for (const role of [Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]) {
      setStoredActiveRole(role);
      expect(getStoredActiveRole()).toBe(role);
    }
  });

  it('ignores a garbage value that is not a known role', () => {
    sessionStorage.setItem('active_role', 'SUPERADMIN');
    expect(getStoredActiveRole()).toBeNull();
  });

  it('ignores an empty stored value', () => {
    sessionStorage.setItem('active_role', '');
    expect(getStoredActiveRole()).toBeNull();
  });

  describe('when storage is unavailable (private mode / disabled)', () => {
    it('getStoredActiveRole returns null instead of throwing', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage denied');
      });
      expect(getStoredActiveRole()).toBeNull();
    });

    it('setStoredActiveRole swallows a throwing setItem', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      expect(() => setStoredActiveRole(Role.ADMIN)).not.toThrow();
    });

    it('clearStoredActiveRole swallows a throwing removeItem', () => {
      jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage denied');
      });
      expect(() => clearStoredActiveRole()).not.toThrow();
    });
  });
});
