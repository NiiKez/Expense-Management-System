import {
  getStoredDemoToken,
  storeDemoToken,
  clearDemoToken,
  isDemoSession,
} from '../../services/demoAuth';

describe('services/demoAuth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it('reports no session when nothing is stored', () => {
    expect(getStoredDemoToken()).toBeNull();
    expect(isDemoSession()).toBe(false);
  });

  it('stores, reads back and clears the demo token under the demo_token key', () => {
    storeDemoToken('demo.jwt.value');

    expect(getStoredDemoToken()).toBe('demo.jwt.value');
    expect(sessionStorage.getItem('demo_token')).toBe('demo.jwt.value');
    expect(isDemoSession()).toBe(true);

    clearDemoToken();

    expect(getStoredDemoToken()).toBeNull();
    expect(isDemoSession()).toBe(false);
  });

  describe('when storage is unavailable (private mode / disabled)', () => {
    it('getStoredDemoToken returns null instead of throwing', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage denied');
      });
      expect(getStoredDemoToken()).toBeNull();
      expect(isDemoSession()).toBe(false);
    });

    it('storeDemoToken swallows a throwing setItem', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      expect(() => storeDemoToken('x')).not.toThrow();
    });

    it('clearDemoToken swallows a throwing removeItem', () => {
      jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage denied');
      });
      expect(() => clearDemoToken()).not.toThrow();
    });
  });
});
