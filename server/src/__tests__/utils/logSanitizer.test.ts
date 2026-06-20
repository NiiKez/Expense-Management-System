import { redactLogValue } from '../../utils/logSanitizer';

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
});
