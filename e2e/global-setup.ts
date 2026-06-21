import type { FullConfig } from '@playwright/test';
import { resetDatabase } from './e2e-db';

/**
 * Runs once before the whole suite. Establishes the canonical seed baseline and
 * fails the run early (before any browser starts) if the E2E database is
 * unreachable or out of sync. Per-test isolation is handled by the auto
 * `freshDatabase` fixture in fixtures/test.ts; this just guarantees a clean,
 * verified starting point and a clear error on misconfiguration.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  await resetDatabase();
}
