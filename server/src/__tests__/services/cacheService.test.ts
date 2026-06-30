import { cacheService } from '../../services/cacheService';

describe('cacheService', () => {
  beforeEach(() => {
    cacheService.flushAll();
  });

  it('round-trips a stored value', () => {
    cacheService.set('k', { a: 1 });
    expect(cacheService.get('k')).toEqual({ a: 1 });
  });

  it('distinguishes a miss (undefined) from a cached null', () => {
    // This distinction is load-bearing: graphApi uses `cached !== undefined` to
    // tell a cache miss apart from a cached "no manager" (null) / empty list.
    expect(cacheService.get('absent')).toBeUndefined();
    cacheService.set('null-key', null);
    expect(cacheService.get('null-key')).toBeNull();
  });

  it('clones on read so a caller cannot mutate the cached value', () => {
    cacheService.set('obj', { nested: { n: 1 } });
    const first = cacheService.get<{ nested: { n: number } }>('obj')!;
    first.nested.n = 999;
    expect(cacheService.get<{ nested: { n: number } }>('obj')!.nested.n).toBe(1);
  });

  it('invalidateUser removes all five per-user keys for that user only', () => {
    cacheService.set('manager:7', { id: 'm' });
    cacheService.set('directReports:7', [{ id: 'r' }]);
    cacheService.set('managerChain:7', [{ id: 'c' }]);
    cacheService.set('groups:7', [{ id: 'g' }]);
    cacheService.set('meProfile:7', { id: 'me' });
    // Another user's keys must be left untouched.
    cacheService.set('manager:8', { id: 'other' });
    cacheService.set('groups:8', [{ id: 'g8' }]);
    cacheService.set('meProfile:8', { id: 'me8' });

    cacheService.invalidateUser(7);

    expect(cacheService.get('manager:7')).toBeUndefined();
    expect(cacheService.get('directReports:7')).toBeUndefined();
    expect(cacheService.get('managerChain:7')).toBeUndefined();
    expect(cacheService.get('groups:7')).toBeUndefined();
    expect(cacheService.get('meProfile:7')).toBeUndefined();

    expect(cacheService.get('manager:8')).toEqual({ id: 'other' });
    expect(cacheService.get('groups:8')).toEqual([{ id: 'g8' }]);
    expect(cacheService.get('meProfile:8')).toEqual({ id: 'me8' });
  });

  it('del removes only the named key', () => {
    cacheService.set('a', 1);
    cacheService.set('b', 2);

    cacheService.del('a');

    expect(cacheService.get('a')).toBeUndefined();
    expect(cacheService.get('b')).toBe(2);
  });

  it('flushAll empties the cache', () => {
    cacheService.set('a', 1);
    cacheService.flushAll();
    expect(cacheService.get('a')).toBeUndefined();
  });
});

describe('cacheService maxKeys degradation', () => {
  const ORIGINAL_MAX_KEYS = process.env.CACHE_MAX_KEYS;

  afterEach(() => {
    if (ORIGINAL_MAX_KEYS === undefined) {
      delete process.env.CACHE_MAX_KEYS;
    } else {
      process.env.CACHE_MAX_KEYS = ORIGINAL_MAX_KEYS;
    }
    jest.dontMock('../../config/logger');
    jest.resetModules();
  });

  it('swallows the node-cache throw at the key ceiling and degrades to a miss', () => {
    jest.resetModules();
    process.env.CACHE_MAX_KEYS = '1';

    const warn = jest.fn();
    jest.doMock('../../config/logger', () => ({
      __esModule: true,
      default: { warn, error: jest.fn(), info: jest.fn(), debug: jest.fn() },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { cacheService: limited } = require('../../services/cacheService') as typeof import('../../services/cacheService');

    limited.set('a', 1);
    // The second key exceeds maxKeys=1; node-cache throws, and set() must swallow it.
    expect(() => limited.set('b', 2)).not.toThrow();
    expect(limited.get('b')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'Cache set failed; continuing without caching',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});
