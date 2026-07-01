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

// Read a strictly-positive integer env var, falling back when it is unset, blank,
// non-numeric, or <= 0. Guards the demo knobs against silently-broken configs:
// a 0/negative TTL would mint dead-on-arrival tokens, and a 0/negative cap would
// wedge every demo-login at "at capacity".
function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  const parsed = intFromEnv(value, fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Lifetime of a demo workspace (token TTL and the user-row demo_expires_at).
export function getDemoTtlSeconds(): number {
  return positiveIntFromEnv(process.env.DEMO_SESSION_TTL_SECONDS, 2 * 60 * 60); // 2 hours
}

// Cap on concurrent live demo workspaces, to bound seeding load and storage.
export function getDemoMaxActive(): number {
  return positiveIntFromEnv(process.env.DEMO_MAX_ACTIVE, 50);
}
