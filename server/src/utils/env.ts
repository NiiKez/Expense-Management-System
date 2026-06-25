// Read an integer-valued environment variable, falling back only when it is
// unset, blank, or not a finite number. Unlike `Number(process.env.X) || fallback`,
// an explicitly-configured `0` (or other falsy-but-valid value) is honored
// instead of being silently rewritten to the fallback — so e.g. PORT=0
// (OS-assigned ephemeral port) or SHUTDOWN_TIMEOUT_MS=0 (immediate exit) work.
export function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
