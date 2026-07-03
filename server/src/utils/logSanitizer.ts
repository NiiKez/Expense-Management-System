import axios from 'axios';

// Field names whose values must never reach logs (matched case-insensitively).
// Covers OBO token responses, bearer headers, OAuth flows, generic secrets, and
// DB connection credentials. Additions are deliberately collision-free: e.g. bare
// `token` is NOT listed (it would redact a benign `tokenizer`), and `email` /
// `displayName` stay visible by design — they are operational context, not secrets.
const SENSITIVE_FIELD_PATTERN = /(access_token|refresh_token|id_token|assertion|client_secret|authorization|password|passwd|pwd|passphrase|secret|api[_-]?key|private[_-]?key|credentials?|cookie|set-cookie|connection[_-]?string|database_url)/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 4;

// Value-level scrubbing: secrets that live INSIDE a string value (not as their
// own key) — e.g. an OAuth redirect URL or a "Bearer <jwt>" in a message — would
// slip past the key-name redaction above. Each pattern below is flat and
// character-class based (no nested quantifiers) to avoid catastrophic
// backtracking on hostile input.

// Query-string params whose value carries a credential/secret.
const SENSITIVE_QUERY_PARAMS =
  /\b(code|access_token|id_token|refresh_token|client_secret|assertion)=[^&\s#]+/gi;
// "Bearer <token>" in any casing — redact the token, keep the scheme.
const BEARER_TOKEN = /\bBearer\s+\S+/gi;
// A JWT: three base64url segments separated by dots.
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// Credentials embedded in a connection-string/URL userinfo, e.g.
// `mysql://user:pass@host` — the `@` anchor keeps a bare `host:port` (no
// userinfo) untouched. Character classes are flat to avoid pathological
// backtracking; the scheme is preserved so the log still shows what failed.
const URI_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]*:[^\s/:@]+@/gi;

function scrubStringValue(value: string): string {
  return value
    .replace(SENSITIVE_QUERY_PARAMS, (_match, key: string) => `${key}=${REDACTED}`)
    .replace(URI_CREDENTIALS, (_match, scheme: string) => `${scheme}${REDACTED}@`)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED);
}

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[DEPTH_LIMIT]';

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_PATTERN.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactLogValue(v, depth + 1);
      }
    }
    return out;
  }

  if (typeof value === 'string') {
    return scrubStringValue(value);
  }

  return value;
}

export function summarizeHttpError(err: unknown): Record<string, unknown> {
  if (!axios.isAxiosError(err)) {
    if (err instanceof Error) {
      return {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    }

    return { value: err };
  }

  return {
    name: err.name,
    message: err.message,
    code: err.code,
    status: err.response?.status,
    method: err.config?.method,
    url: err.config?.url,
    responseData: redactLogValue(err.response?.data),
  };
}
