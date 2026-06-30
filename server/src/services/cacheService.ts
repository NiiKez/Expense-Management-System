import NodeCache from 'node-cache';
import logger from '../config/logger';
import { intFromEnv } from '../utils/env';

const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 60, // Check for expired keys every 60s
  useClones: true,
  // Hard ceiling on entries. Today keys are one-per-user (manager:/directReports:),
  // so growth is naturally bounded — but a future per-request key design mistake
  // would otherwise grow memory unbounded. maxKeys makes that fail loudly (set
  // throws) instead of leaking memory.
  maxKeys: intFromEnv(process.env.CACHE_MAX_KEYS, 50_000),
});

export const cacheService = {
  /**
   * Get a cached value by key.
   */
  get<T>(key: string): T | undefined {
    return cache.get<T>(key);
  },

  /**
   * Set a cached value with default TTL. Caching is best-effort: if the store is
   * at maxKeys, node-cache throws — swallow it so a full cache degrades to a
   * cache-miss instead of failing the request.
   */
  set<T>(key: string, value: T, ttl?: number): void {
    try {
      cache.set(key, value, ttl ?? CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn('Cache set failed; continuing without caching', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /**
   * Delete a specific key from the cache.
   */
  del(key: string): void {
    cache.del(key);
  },

  /**
   * Invalidate all cache entries for a given user ID. Removes every per-user
   * Graph cache key: manager, direct reports, manager chain, group memberships
   * and the caller's own org profile.
   */
  invalidateUser(userId: number): void {
    const keysToDelete = [
      `manager:${userId}`,
      `directReports:${userId}`,
      `managerChain:${userId}`,
      `groups:${userId}`,
      `meProfile:${userId}`,
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
