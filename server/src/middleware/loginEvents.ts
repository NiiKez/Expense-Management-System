import { Request } from 'express';
import { SecurityEventType, SecurityOutcome } from '../types';
import { securityEventModel } from '../models/securityEvent';

// A single Entra access token is presented on MANY requests (every API call the SPA
// makes while signed in), so recording a login event per authenticated request would
// bury the trail in noise. Instead we record ONE LOGIN_SUCCESS per freshly-issued
// token — a genuine "a session was established for this user" signal — by:
//   (a) only considering a token whose `iat` is recent (a routine request hours into
//       a session carries an old iat and is ignored), and
//   (b) de-duplicating by (oid, iat) in a small, self-pruning in-process map.
// State is per-process and best-effort: after a scale-to-zero cold start a still-fresh
// token may re-emit once, which is harmless for an audit trail. MSAL mints a new token
// on interactive login and on each silent refresh, so this fires ~once per sign-in and
// ~once per token refresh — a reasonable session/auth heartbeat.
const FRESH_WINDOW_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5000;
const seen = new Map<string, number>(); // `${oid}:${iat}` -> recorded-at (ms)

function prune(nowMs: number): void {
  for (const [key, recordedAt] of seen) {
    if (nowMs - recordedAt > FRESH_WINDOW_MS) seen.delete(key);
  }
  // Hard cap so a pathological spray of unique tokens can't grow the map unbounded.
  if (seen.size > MAX_ENTRIES) seen.clear();
}

interface LoginContext {
  oid: string;
  iat?: number; // JWT issued-at, seconds since epoch
  userId: number;
  role: string;
}

/**
 * Record a successful Entra sign-in ONCE per freshly-issued token. Best-effort and
 * fire-and-forget (record() never throws), so it never delays or breaks the auth path.
 */
export function recordLoginSuccess(req: Request, ctx: LoginContext): void {
  if (typeof ctx.iat !== 'number') return; // no iat -> cannot dedupe safely
  const nowMs = Date.now();
  if (nowMs - ctx.iat * 1000 > FRESH_WINDOW_MS) return; // old token -> routine request, not a sign-in
  const key = `${ctx.oid}:${ctx.iat}`;
  if (seen.has(key)) return; // already recorded this token's first use
  prune(nowMs);
  seen.set(key, nowMs);

  void securityEventModel.record({
    event_type: SecurityEventType.LOGIN_SUCCESS,
    outcome: SecurityOutcome.SUCCESS,
    user_id: ctx.userId,
    entra_oid: ctx.oid,
    role: ctx.role,
    ip_address: req.ip ?? null,
    request_id: req.id ?? null,
    detail: 'Entra session established',
  });
}

// Test-only: clear the in-process dedupe so unit tests stay deterministic.
export function __resetLoginDedupe(): void {
  seen.clear();
}
