import TransportStream from 'winston-transport';
import crypto from 'crypto';
import os from 'os';

// Batched Winston transport that ships log lines to the Pulsar dashboard's
// `ingest-logs` edge function (a plain HTTPS POST — Pulsar here is the dashboard,
// not Apache Pulsar). It is env-gated: nothing is sent unless both PULSAR_LOGS_URL
// and LOGS_INGEST_KEY are set, so a default deployment ships nothing.
//
// Hardening (all deliberate — see docs/app-logs-feature-plan.md Phase 1):
//   - Never blocks the app: log() enqueues and acks synchronously; delivery is async.
//   - Bounded buffer with a drop-oldest policy, so a down/slow Pulsar can never OOM us.
//   - Flush on size, on a timer, and on shutdown (the app SIGTERM path awaits flush()).
//   - Its own failures go to stderr ONLY — never back through the logger (no feedback loop).
//   - Client-side caps mirror the endpoint's (≤500 rows / ≤256 KB body / 8 KB message +
//     metadata) so a single fat line can't get the whole batch 413'd.
//   - A per-row dedup_key makes at-least-once retries idempotent server-side.

const HOSTNAME = os.hostname();

// Internal tuning. Kept as constants (not env) to avoid config sprawl — the only
// knobs an operator needs are the URL, key, and level, exposed below.
const BATCH_ROWS = 200; //            < the endpoint's 500-row cap
const BATCH_BYTES = 200_000; //       < the endpoint's 256 KB body cap
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_ROWS = 10_000; //    hard ceiling; oldest lines dropped past this
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_FLUSH_MS = 4_000; //   best-effort drain budget on exit (< the app's 10s force-kill)
const MSG_MAX_CHARS = 8_000; //       <= the endpoint's 8192 message cap
const META_MAX_BYTES = 8_000; //      <= the endpoint's 8192 metadata cap
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
const WARN_THROTTLE_MS = 60_000; //   at most one stderr diagnostic per minute

// Envelope fields we map explicitly (or that identify the batch); everything else
// on the Winston `info` object becomes per-line metadata.
const ENVELOPE_KEYS = new Set(['level', 'message', 'timestamp', 'service', 'env', 'requestId']);

const NPM_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

export interface PulsarLogsConfig {
  url: string;
  key: string;
  source: string;
  env: string;
  level: string;
}

interface LogRow {
  level: string;
  message: string;
  ts: string;
  request_id?: string;
  host?: string;
  dedup_key: string;
  metadata?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Circular- and bigint-safe replacer so a metadata blob (e.g. an express req/res
// object) can never throw during serialization.
function safeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

function coerceMessage(raw: unknown): string {
  let s: string;
  if (typeof raw === 'string') {
    s = raw;
  } else {
    try {
      s = JSON.stringify(raw, safeReplacer()) ?? String(raw);
    } catch {
      s = String(raw);
    }
  }
  return s.length > MSG_MAX_CHARS ? s.slice(0, MSG_MAX_CHARS) : s;
}

// Serialize + byte-cap metadata, and round-trip it to a plain JSON-safe value so
// the later whole-batch stringify can never throw on it.
function capMetadata(raw: unknown): unknown {
  if (raw === undefined) return undefined;
  let json: string | undefined;
  try {
    json = JSON.stringify(raw, safeReplacer());
  } catch {
    return { _unserializable: true };
  }
  if (json === undefined) return undefined;
  const bytes = Buffer.byteLength(json);
  if (bytes > META_MAX_BYTES) return { _truncated: true, bytes };
  return JSON.parse(json);
}

function buildMetadata(info: Record<string, unknown>): unknown {
  const meta: Record<string, unknown> = {};
  for (const key of Object.keys(info)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    meta[key] = info[key];
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function normalizeTs(raw: unknown): string {
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function approxRowBytes(row: LogRow): number {
  return Buffer.byteLength(JSON.stringify(row)) + 1;
}

export class PulsarLogsTransport extends TransportStream {
  private readonly cfg: PulsarLogsConfig;
  private readonly queue: LogRow[] = [];
  private flushing = false;
  private nextAttemptAt = 0;
  private backoffMs = BACKOFF_BASE_MS;
  private dropped = 0;
  private lastWarnAt = 0;
  private healthy = true;
  private readonly timer: NodeJS.Timeout;

  constructor(cfg: PulsarLogsConfig) {
    // `level` gates which severities Winston forwards to THIS transport (default
    // warn, so info/debug aren't shipped to the free tier unless opted in).
    super({ level: cfg.level });
    this.cfg = cfg;
    this.timer = setInterval(() => void this.drain(), FLUSH_INTERVAL_MS);
    // Don't let the flush timer keep the process alive.
    this.timer.unref();
  }

  log(info: Record<string, unknown>, next: () => void): void {
    // Winston must never wait on the network. Enqueue synchronously and ack now;
    // any failure here stays on stderr and must not re-enter the logger.
    try {
      this.enqueue(info);
    } catch (err) {
      this.reportError('failed to enqueue log line', err);
    }
    next();
  }

  private enqueue(info: Record<string, unknown>): void {
    const row: LogRow = {
      level: typeof info.level === 'string' ? info.level : 'info',
      message: coerceMessage(info.message),
      ts: normalizeTs(info.timestamp),
      request_id: str(info.requestId),
      host: HOSTNAME,
      // Generated once, here — so a retried batch re-sends the SAME key and the
      // server dedupes it instead of duplicating the row.
      dedup_key: crypto.randomUUID(),
      metadata: capMetadata(buildMetadata(info)),
    };
    this.queue.push(row);

    if (this.queue.length > MAX_BUFFER_ROWS) {
      const overflow = this.queue.length - MAX_BUFFER_ROWS;
      this.queue.splice(0, overflow); // drop oldest — keep the freshest context
      this.dropped += overflow;
      this.reportError(
        `log buffer full; dropped ${overflow} oldest line(s) (dropped ${this.dropped} total)`,
      );
    }

    if (!this.flushing && this.queue.length >= BATCH_ROWS && Date.now() >= this.nextAttemptAt) {
      void this.drain();
    }
  }

  // Take up to a batch's worth of rows off the front, bounded by both the row
  // count and the byte budget (always at least one row, even if oversized).
  private takeBatch(): LogRow[] {
    const batch: LogRow[] = [];
    let bytes = 128; // rough envelope overhead: {"source":..,"env":..,"logs":[]}
    while (this.queue.length > 0 && batch.length < BATCH_ROWS) {
      const rowBytes = approxRowBytes(this.queue[0]);
      if (batch.length > 0 && bytes + rowBytes > BATCH_BYTES) break;
      batch.push(this.queue.shift() as LogRow);
      bytes += rowBytes;
    }
    return batch;
  }

  private requeue(batch: LogRow[]): void {
    this.queue.unshift(...batch);
    if (this.queue.length > MAX_BUFFER_ROWS) {
      const overflow = this.queue.length - MAX_BUFFER_ROWS;
      this.queue.splice(0, overflow);
      this.dropped += overflow;
    }
  }

  private async drain(): Promise<void> {
    if (this.flushing) return;
    if (Date.now() < this.nextAttemptAt) return;
    if (this.queue.length === 0) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.takeBatch();
        const result = await this.send(batch, Date.now() + REQUEST_TIMEOUT_MS);
        if (result === 'ok') {
          this.onSuccess();
        } else if (result === 'retry') {
          this.requeue(batch);
          this.onFailure();
          break; // stop draining; the timer will retry after the backoff
        }
        // 'drop' → non-retryable; batch already removed, keep draining the rest.
      }
    } finally {
      this.flushing = false;
    }
  }

  private async send(batch: LogRow[], deadline: number): Promise<'ok' | 'retry' | 'drop'> {
    const timeout = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
    if (timeout <= 0) return 'retry';

    const body = JSON.stringify({ source: this.cfg.source, env: this.cfg.env, logs: batch });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(this.cfg.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.key}`, // key stays in the header, never logged
        },
        body,
        signal: controller.signal,
      });
      // Always drain the body so the socket can be reused.
      const text = await res.text().catch(() => '');
      if (res.ok) return 'ok';
      if (res.status === 429 || res.status >= 500) {
        this.reportError(`Pulsar ingest returned ${res.status}; will retry`);
        return 'retry';
      }
      // 400/401/413 and other 4xx: bad key / malformed / oversized — retrying
      // won't help, so drop rather than loop forever.
      this.reportError(
        `Pulsar ingest rejected ${batch.length} line(s) (${res.status}); dropping: ${text.slice(0, 200)}`,
      );
      return 'drop';
    } catch (err) {
      this.reportError('Pulsar ingest request failed; will retry', err);
      return 'retry';
    } finally {
      clearTimeout(timer);
    }
  }

  private onSuccess(): void {
    this.nextAttemptAt = 0;
    this.backoffMs = BACKOFF_BASE_MS;
    if (!this.healthy) {
      this.healthy = true;
      // eslint-disable-next-line no-console
      console.error('[pulsar-logs] delivery recovered');
    }
  }

  private onFailure(): void {
    this.nextAttemptAt = Date.now() + this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.healthy = false;
  }

  // Diagnostics go to stderr only — routing them through the app logger would feed
  // the transport its own failures. Throttled so an outage can't flood stderr.
  private reportError(message: string, err?: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_THROTTLE_MS) return;
    this.lastWarnAt = now;
    const detail = err ? ` (${errText(err)})` : '';
    // eslint-disable-next-line no-console
    console.error(`[pulsar-logs] ${message}${detail}`);
  }

  // Best-effort drain on shutdown. Bypasses the backoff (this is the last chance to
  // deliver) and is bounded by SHUTDOWN_FLUSH_MS so it can't hang the deploy.
  async flush(): Promise<void> {
    clearInterval(this.timer);
    const deadline = Date.now() + SHUTDOWN_FLUSH_MS;
    this.nextAttemptAt = 0;
    while (this.queue.length > 0 && Date.now() < deadline) {
      if (this.flushing) {
        await sleep(50);
        continue;
      }
      this.flushing = true;
      try {
        const batch = this.takeBatch();
        const result = await this.send(batch, deadline);
        if (result === 'retry') {
          this.requeue(batch);
          break; // endpoint is down; don't spin — the force-exit timer will take over
        }
      } finally {
        this.flushing = false;
      }
    }
    if (this.queue.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`[pulsar-logs] shutdown flush incomplete; ${this.queue.length} line(s) undelivered`);
    }
  }
}

function resolveTransportLevel(): string {
  const requested = process.env.PULSAR_LOGS_LEVEL;
  if (!requested) return 'warn'; // default: ship warn + error only
  if (NPM_LEVELS.includes(requested)) return requested;
  // eslint-disable-next-line no-console
  console.warn(`Ignoring invalid PULSAR_LOGS_LEVEL "${requested}"; falling back to "warn"`);
  return 'warn';
}

function readConfig(): PulsarLogsConfig | null {
  const url = process.env.PULSAR_LOGS_URL?.trim();
  const key = process.env.LOGS_INGEST_KEY?.trim();
  if (!url && !key) return null; // feature off — the common case
  if (!url || !key) {
    // eslint-disable-next-line no-console
    console.warn('Pulsar log shipping disabled: set BOTH PULSAR_LOGS_URL and LOGS_INGEST_KEY');
    return null;
  }
  return {
    url,
    key,
    source: process.env.PULSAR_LOGS_SOURCE?.trim() || 'expense-management-api',
    env: process.env.NODE_ENV ?? 'development',
    level: resolveTransportLevel(),
  };
}

let cached: PulsarLogsTransport | null | undefined;

// Lazy singleton. Returns null when the feature is disabled (no env config).
export function getPulsarLogsTransport(): PulsarLogsTransport | null {
  if (cached === undefined) {
    const cfg = readConfig();
    cached = cfg ? new PulsarLogsTransport(cfg) : null;
  }
  return cached;
}

// Called from the graceful-shutdown path so buffered lines are delivered on exit.
export async function flushPulsarLogs(): Promise<void> {
  const transport = getPulsarLogsTransport();
  if (transport) await transport.flush();
}
