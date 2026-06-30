import { ResultSetHeader } from 'mysql2/promise';
import pool from '../config/db';
import logger from '../config/logger';
import { redactLogValue } from '../utils/logSanitizer';
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
    // The entire body is best-effort: recording a security event MUST NEVER throw
    // into the auth/request path that triggered it, so both the log emission and
    // the DB write are wrapped together. `detail`/`metadata` are scrubbed of any
    // accidental token/secret before they are emitted OR persisted — the stdout
    // line is also redacted by Winston, but the DB row would otherwise store the
    // raw value, so we redact here so both sinks get the same clean value.
    try {
      const safeDetail = clamp(
        redactLogValue(event.detail) as string | null | undefined,
        MAX_LENGTHS.detail,
      );
      const safeMetadata =
        event.metadata !== undefined && event.metadata !== null
          ? redactLogValue(event.metadata)
          : null;

      // Step 1 — the alert line. Deliberately excludes `metadata` to keep the line
      // compact and to avoid logging a bulky/freeform payload. FAILURE outcomes
      // log at warn level, benign ones at info.
      const line = {
        event: event.event_type,
        outcome: event.outcome,
        user_id: event.user_id ?? null,
        entra_oid: event.entra_oid ?? null,
        role: event.role ?? null,
        ip_address: event.ip_address ?? null,
        request_id: event.request_id ?? null,
        detail: safeDetail,
      };
      if (event.outcome === SecurityOutcome.FAILURE) {
        logger.warn('Security event', line);
      } else {
        logger.info('Security event', line);
      }

      // Step 2 — the durable row.
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
          safeDetail,
          safeMetadata !== null ? JSON.stringify(safeMetadata) : null,
        ],
      );
    } catch (err) {
      // Swallow: a logging-table outage (or any unexpected error here) must not
      // propagate into the request that triggered it. The inner guard keeps even
      // this diagnostic from throwing.
      try {
        logger.warn('Failed to persist security event', {
          event_type: event.event_type,
          err: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* last resort — nothing further we can safely do */
      }
    }
  },
};
