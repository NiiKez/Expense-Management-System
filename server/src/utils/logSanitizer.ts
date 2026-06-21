import axios from 'axios';

// Field names whose values must never reach logs (matched case-insensitively).
// Covers OBO token responses, bearer headers, OAuth flows, and generic secrets.
const SENSITIVE_FIELD_PATTERN = /(access_token|refresh_token|id_token|assertion|client_secret|authorization|password|secret|api[_-]?key|cookie|set-cookie)/i;
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

function scrubStringValue(value: string): string {
  return value
    .replace(SENSITIVE_QUERY_PARAMS, (_match, key: string) => `${key}=${REDACTED}`)
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
