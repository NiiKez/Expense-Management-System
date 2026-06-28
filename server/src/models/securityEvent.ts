import { ResultSetHeader } from 'mysql2/promise';
import pool from '../config/db';
import logger from '../config/logger';
import { SecurityEventInput, SecurityOutcome } from '../types';

// Column widths from schema.sql. Inputs are defensively clamped to these so an
// unexpectedly long value (e.g. an oversized oid claim, a verbose JWT error
// message) can never fail the INSERT and silently lose the event.
const MAX_LENGTHS = {
  entra_oid: 36,
  role: 16,
  ip_address: 45,
  request_id: 200,
  detail: 255,
} as const;

function clamp(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export const securityEventModel = {
  /**
   * Record a security event. Two parts, by design:
   *
   *  1. Always emit ONE structured Winston line carrying a stable, machine-
   *     parseable `event` code — log-based alert rules key off this, so it must
   *     fire even when the database write below fails. FAILURE outcomes log at
   *     warn level, benign ones at info.
   *  2. Persist a durable row. The write is BEST-EFFORT and MUST NEVER throw into
   *     the auth/request path: a logging-table outage cannot be allowed to break
   *     authentication, so on failure we warn and swallow.
   */
  async record(event: SecurityEventInput): Promise<void> {
    // Step 1 — the alert line. Emitted first so it survives even if the insert
    // fails. Deliberately excludes `metadata` to keep the line compact and to
    // avoid any chance of logging a bulky/freeform payload.
    const line = {
      event: event.event_type,
      outcome: event.outcome,
      user_id: event.user_id ?? null,
      entra_oid: event.entra_oid ?? null,
      role: event.role ?? null,
      ip_address: event.ip_address ?? null,
      request_id: event.request_id ?? null,
      detail: event.detail ?? null,
    };
    if (event.outcome === SecurityOutcome.FAILURE) {
      logger.warn('Security event', line);
    } else {
      logger.info('Security event', line);
    }

    // Step 2 — the durable row (best-effort).
    try {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO security_events
           (event_type, outcome, user_id, entra_oid, role, ip_address, request_id, detail, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.event_type,
          event.outcome,
          event.user_id ?? null,
          clamp(event.entra_oid, MAX_LENGTHS.entra_oid),
          clamp(event.role, MAX_LENGTHS.role),
          clamp(event.ip_address, MAX_LENGTHS.ip_address),
          clamp(event.request_id, MAX_LENGTHS.request_id),
          clamp(event.detail, MAX_LENGTHS.detail),
          event.metadata ? JSON.stringify(event.metadata) : null,
        ],
      );
    } catch (err) {
      // Swallow: the event is already on stdout (step 1); a persistence failure
      // must not propagate into the request that triggered it.
      logger.warn('Failed to persist security event', {
        event_type: event.event_type,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
