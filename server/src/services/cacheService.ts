import NodeCache from 'node-cache';
import logger from '../config/logger';

const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60, // Check for expired keys every 60s
  useClones: true,
});

export const cacheService = {
  /**
   * Get a cached value by key.
   */
  get<T>(key: string): T | undefined {
    return cache.get<T>(key);
  },

  /**
   * Set a cached value with default TTL.
   */
  set<T>(key: string, value: T, ttl?: number): void {
    cache.set(key, value, ttl ?? CACHE_TTL_SECONDS);
  },

  /**
   * Delete a specific key from the cache.
   */
  del(key: string): void {
    cache.del(key);
  },

  /**
   * Invalidate all cache entries for a given user ID.
   * Removes both manager and direct-reports cache keys.
   */
  invalidateUser(userId: number): void {
    const keysToDelete = [
      `manager:${userId}`,
      `directReports:${userId}`,
    ];
    cache.del(keysToDelete);
    logger.debug('Invalidated cache for user', { userId, keys: keysToDelete });
  },

  /**
   * Flush all cached data.
   */
  flushAll(): void {
    cache.flushAll();
  },
};
