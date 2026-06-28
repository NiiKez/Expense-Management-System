import { intFromEnv } from '../utils/env';

// Public demo sandbox configuration. All demo behavior is off unless ENABLE_DEMO
// is explicitly 'true' AND a signing secret is provided (server.ts fail-fasts if
// the flag is on without a secret), so a default deployment exposes nothing.

export function isDemoEnabled(): boolean {
  return process.env.ENABLE_DEMO === 'true' && !!process.env.DEMO_JWT_SECRET;
}

export function getDemoSecret(): string | undefined {
  return process.env.DEMO_JWT_SECRET;
}

// Lifetime of a demo workspace (token TTL and the user-row demo_expires_at).
export function getDemoTtlSeconds(): number {
  return intFromEnv(process.env.DEMO_SESSION_TTL_SECONDS, 2 * 60 * 60); // 2 hours
}

// Cap on concurrent live demo workspaces, to bound seeding load and storage.
export function getDemoMaxActive(): number {
  return intFromEnv(process.env.DEMO_MAX_ACTIVE, 50);
}
