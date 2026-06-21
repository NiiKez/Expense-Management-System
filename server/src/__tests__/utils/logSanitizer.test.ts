import { redactLogValue, summarizeHttpError } from '../../utils/logSanitizer';

describe('redactLogValue', () => {
  it('redacts nested secret-bearing fields before they reach logs', () => {
    const redacted = redactLogValue({
      authorization: 'Bearer token',
      nested: {
        client_secret: 'secret',
        safe: 'value',
      },
    });

    expect(redacted).toEqual({
      authorization: '[REDACTED]',
      nested: {
        client_secret: '[REDACTED]',
        safe: 'value',
      },
    });
  });

  // Every alternative baked into SENSITIVE_FIELD_PATTERN must redact its value.
  // `api[_-]?key` covers api_key / api-key / apikey; set-cookie is matched by
  // both the `cookie` and `set-cookie` alternatives.
  const sensitiveFields = [
    'access_token',
    'refresh_token',
    'id_token',
    'assertion',
    'client_secret',
    'authorization',
    'password',
    'secret',
    'api_key',
    'api-key',
    'apikey',
    'cookie',
    'set-cookie',
  ];

  it.each(sensitiveFields)('redacts the sensitive field "%s"', (field) => {
    const redacted = redactLogValue({ [field]: 'super-secret-value' }) as Record<string, unknown>;
    expect(redacted[field]).toBe('[REDACTED]');
  });

  it.each([
    ['Authorization', 'Bearer abc'],
    ['ACCESS_TOKEN', 'eyJ...'],
    ['Client_Secret', 'shhh'],
    ['Set-Cookie', 'session=1'],
  ])('matches field names case-insensitively (%s)', (field, value) => {
    const redacted = redactLogValue({ [field]: value }) as Record<string, unknown>;
    expect(redacted[field]).toBe('[REDACTED]');
  });

  it.each(['username', 'email', 'displayName', 'amount', 'category', 'tokenizer'])(
    'does not redact the benign field "%s"',
    (field) => {
      const redacted = redactLogValue({ [field]: 'visible-value' }) as Record<string, unknown>;
      expect(redacted[field]).toBe('visible-value');
    },
  );

  it('redacts secrets inside arrays of objects', () => {
    const redacted = redactLogValue({
      headers: [
        { authorization: 'Bearer one', name: 'first' },
        { cookie: 'sid=2', name: 'second' },
      ],
    });

    expect(redacted).toEqual({
      headers: [
        { authorization: '[REDACTED]', name: 'first' },
        { cookie: '[REDACTED]', name: 'second' },
      ],
    });
  });

  it('redacts secrets at depth in nested objects and arrays', () => {
    // Array element sits at depth 2 (root 0 → array 1 → element 2), so its own
    // fields are inspected at depth 3 — below the depth-4 guard — and both the
    // redaction and the benign sibling survive intact.
    const redacted = redactLogValue({
      items: [{ access_token: 'leak-me', keep: 'ok' }],
    });

    expect(redacted).toEqual({
      items: [{ access_token: '[REDACTED]', keep: 'ok' }],
    });
  });

  // ── Value-level scrubbing (secrets embedded inside string values) ──
  // Key-name redaction misses secrets that live INSIDE a benign-keyed string —
  // e.g. an OAuth redirect URL or a "Bearer <jwt>" inside a free-text message.
  // These must be scrubbed by value, not just by key.

  it('redacts sensitive query-string params inside a URL value', () => {
    const redacted = redactLogValue({
      url: 'https://app/callback?code=leak123&client_secret=topsecretvalue&state=keep',
    }) as Record<string, unknown>;

    const url = redacted.url as string;
    // The credential VALUES are gone (the param names may still mention "secret").
    expect(url).not.toContain('leak123');
    expect(url).not.toContain('topsecretvalue');
    expect(url).toContain('code=[REDACTED]');
    expect(url).toContain('client_secret=[REDACTED]');
    // Non-sensitive params are preserved.
    expect(url).toContain('state=keep');
  });

  it('redacts a Bearer JWT embedded in a free-text message value', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dumm-signature_123';
    const redacted = redactLogValue({
      message: `auth failed for Authorization: Bearer ${jwt}`,
    }) as Record<string, unknown>;

    const message = redacted.message as string;
    expect(message).not.toContain(jwt);
    expect(message).toContain('Bearer [REDACTED]');
  });

  it('redacts a bare JWT-shaped substring even without a Bearer prefix', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.sig-part_456';
    const redacted = redactLogValue(`token is ${jwt} now`);
    expect(redacted).not.toContain(jwt);
    expect(redacted).toContain('[REDACTED]');
  });

  it('leaves a benign string value untouched', () => {
    expect(redactLogValue('a normal log line with no secrets')).toBe(
      'a normal log line with no secrets',
    );
    expect(redactLogValue('https://app/page?state=keep&view=list')).toBe(
      'https://app/page?state=keep&view=list',
    );
  });

  it('preserves null and undefined values', () => {
    expect(redactLogValue(null)).toBeNull();
    expect(redactLogValue(undefined)).toBeUndefined();
  });

  it('passes primitive values through untouched', () => {
    expect(redactLogValue('plain')).toBe('plain');
    expect(redactLogValue(42)).toBe(42);
    expect(redactLogValue(true)).toBe(true);
  });

  it('stops recursing at the depth limit and substitutes the sentinel', () => {
    // MAX_DEPTH is 4. The top-level call is depth 0, so a value nested deeper
    // than four levels of objects hits the '[DEPTH_LIMIT]' guard.
    const deep = { a: { b: { c: { d: { e: 'too-deep' } } } } };

    const redacted = redactLogValue(deep) as Record<string, unknown>;

    expect(redacted).toEqual({ a: { b: { c: { d: '[DEPTH_LIMIT]' } } } });
  });

  it('does not redact below the depth limit even for secret keys it can no longer see', () => {
    // The depth guard fires before key inspection, so a secret buried past the
    // limit is replaced wholesale by the sentinel rather than per-field redaction.
    const deep = { a: { b: { c: { d: { password: 'unreachable' } } } } };

    const redacted = redactLogValue(deep) as Record<string, unknown>;

    expect(redacted).toEqual({ a: { b: { c: { d: '[DEPTH_LIMIT]' } } } });
  });
});

describe('summarizeHttpError', () => {
  it('summarizes an Axios error, redacting response data while keeping url/status/method', () => {
    // Shape an axios-style error the way axios.isAxiosError detects it.
    const axiosError = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      name: 'AxiosError',
      code: 'ERR_BAD_REQUEST',
      config: { method: 'post', url: 'https://login.microsoftonline.com/token' },
      response: {
        status: 401,
        data: {
          access_token: 'super-secret-token',
          error: 'invalid_grant',
        },
      },
    });

    const summary = summarizeHttpError(axiosError);

    expect(summary).toEqual({
      name: 'AxiosError',
      message: 'Request failed with status code 401',
      code: 'ERR_BAD_REQUEST',
      status: 401,
      method: 'post',
      url: 'https://login.microsoftonline.com/token',
      responseData: {
        access_token: '[REDACTED]',
        error: 'invalid_grant',
      },
    });
  });

  it('never leaks the raw secret from an Axios error response in the summary', () => {
    const axiosError = Object.assign(new Error('boom'), {
      isAxiosError: true,
      name: 'AxiosError',
      config: { method: 'get', url: '/secrets' },
      response: { status: 500, data: { refresh_token: 'leak-me-now' } },
    });

    const summary = summarizeHttpError(axiosError);

    expect(JSON.stringify(summary)).not.toContain('leak-me-now');
    expect((summary.responseData as Record<string, unknown>).refresh_token).toBe('[REDACTED]');
  });

  it('returns name/message/stack for a plain Error', () => {
    const err = new Error('something broke');

    const summary = summarizeHttpError(err);

    expect(summary).toEqual({
      name: 'Error',
      message: 'something broke',
      stack: err.stack,
    });
  });

  it('wraps non-Error, non-Axios values under a "value" key', () => {
    expect(summarizeHttpError('just a string')).toEqual({ value: 'just a string' });
    expect(summarizeHttpError(123)).toEqual({ value: 123 });
  });
});
