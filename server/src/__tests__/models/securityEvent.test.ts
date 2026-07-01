import pool from '../../config/db';
import logger from '../../config/logger';
import { securityEventModel } from '../../models/securityEvent';
import { SecurityEventType, SecurityOutcome } from '../../types';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedPool = pool as unknown as { execute: jest.Mock };
const mockedLogger = logger as unknown as { info: jest.Mock; warn: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('securityEventModel.record', () => {
  it('inserts one row and emits a stable, machine-parseable info line for benign events', async () => {
    mockedPool.execute.mockResolvedValue([{ insertId: 1 }]);

    await securityEventModel.record({
      event_type: SecurityEventType.AUDIT_LOG_EXPORTED,
      outcome: SecurityOutcome.SUCCESS,
      user_id: 7,
      role: 'ADMIN',
      ip_address: '127.0.0.1',
      request_id: 'req-1',
      detail: 'Exported 3 audit-log row(s)',
      metadata: { row_count: 3 },
    });

    expect(mockedPool.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO security_events/);
    expect(params[0]).toBe(SecurityEventType.AUDIT_LOG_EXPORTED);
    expect(params[1]).toBe(SecurityOutcome.SUCCESS);
    expect(params[2]).toBe(7);
    // metadata is JSON-serialized for the JSON column.
    expect(params[8]).toBe(JSON.stringify({ row_count: 3 }));

    // The alert line carries the stable `event` code at info level (benign).
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Security event',
      expect.objectContaining({ event: SecurityEventType.AUDIT_LOG_EXPORTED, outcome: SecurityOutcome.SUCCESS }),
    );
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  it('logs FAILURE outcomes at warn level', async () => {
    mockedPool.execute.mockResolvedValue([{ insertId: 2 }]);

    await securityEventModel.record({
      event_type: SecurityEventType.AUTH_FAILURE,
      outcome: SecurityOutcome.FAILURE,
      detail: 'jwt expired',
    });

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Security event',
      expect.objectContaining({ event: SecurityEventType.AUTH_FAILURE }),
    );
  });

  it('passes null through for the JSON column when no metadata is given', async () => {
    mockedPool.execute.mockResolvedValue([{ insertId: 3 }]);

    await securityEventModel.record({
      event_type: SecurityEventType.STUB_AUTH_USED,
      outcome: SecurityOutcome.SUCCESS,
    });

    const [, params] = mockedPool.execute.mock.calls[0];
    expect(params[8]).toBeNull();
  });

  it('never throws and warns instead when the DB write rejects (best-effort)', async () => {
    mockedPool.execute.mockRejectedValue(new Error('security_events is gone'));

    await expect(
      securityEventModel.record({
        event_type: SecurityEventType.AUTH_FAILURE,
        outcome: SecurityOutcome.FAILURE,
      }),
    ).resolves.toBeUndefined();

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Failed to persist security event',
      expect.objectContaining({ event_type: SecurityEventType.AUTH_FAILURE }),
    );
  });

  it('still emits the alert line even when the durable write fails', async () => {
    mockedPool.execute.mockRejectedValue(new Error('db down'));

    await securityEventModel.record({
      event_type: SecurityEventType.ACCESS_DENIED,
      outcome: SecurityOutcome.FAILURE,
    });

    // The stable 'Security event' line fires before (and survives) the failed insert.
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Security event',
      expect.objectContaining({ event: SecurityEventType.ACCESS_DENIED }),
    );
  });

  it('defensively clamps over-long values to their column widths', async () => {
    mockedPool.execute.mockResolvedValue([{ insertId: 4 }]);

    await securityEventModel.record({
      event_type: SecurityEventType.ACCESS_DENIED,
      outcome: SecurityOutcome.FAILURE,
      entra_oid: 'x'.repeat(80),  // column is VARCHAR(36)
      detail: 'y'.repeat(400),    // column is VARCHAR(255)
    });

    const [, params] = mockedPool.execute.mock.calls[0];
    expect((params[3] as string).length).toBe(36); // entra_oid
    expect((params[7] as string).length).toBe(255); // detail
  });

  it('redacts a secret-shaped `detail` before persisting it (both sinks get the clean value)', async () => {
    mockedPool.execute.mockResolvedValue([{ insertId: 5 }]);

    // Fake JWT fixture: canonical jwt.io header/payload with an obviously-dummy
    // signature (matches the .gitleaks.toml test-fixture allowlist).
    const secret = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dumm-signature_secevt';
    await securityEventModel.record({
      event_type: SecurityEventType.AUTH_FAILURE,
      outcome: SecurityOutcome.FAILURE,
      detail: `bad token: Bearer ${secret}`,
    });

    // The persisted `detail` param (index 7) must NOT contain the raw token.
    const [, params] = mockedPool.execute.mock.calls[0];
    const persistedDetail = params[7] as string;
    expect(persistedDetail).not.toContain(secret);
    expect(persistedDetail).toContain('[REDACTED]');

    // And the emitted alert line carries the same scrubbed value, not the raw one.
    const [, line] = mockedLogger.warn.mock.calls[0] as [string, { detail: string }];
    expect(line.detail).not.toContain(secret);
    expect(line.detail).toContain('[REDACTED]');
  });

  it('redacts secret-keyed `metadata` before serializing it to the JSON column', async () => {
    mockedPool.execute.mockResolvedValue([{ insertId: 6 }]);

    await securityEventModel.record({
      event_type: SecurityEventType.ACCESS_DENIED,
      outcome: SecurityOutcome.FAILURE,
      metadata: { password: 'hunter2', client_secret: 's3cr3t', reason: 'not-allowlisted' },
    });

    const [, params] = mockedPool.execute.mock.calls[0];
    const persistedMetadata = params[8] as string;
    // Secret-named keys are scrubbed; the benign field survives.
    expect(persistedMetadata).not.toContain('hunter2');
    expect(persistedMetadata).not.toContain('s3cr3t');
    expect(persistedMetadata).toContain('[REDACTED]');
    expect(persistedMetadata).toContain('not-allowlisted');
    // Still valid JSON for the JSON column.
    expect(JSON.parse(persistedMetadata)).toEqual({
      password: '[REDACTED]',
      client_secret: '[REDACTED]',
      reason: 'not-allowlisted',
    });
  });

  it('the inner try/catch keeps record() resolving even if the diagnostic warn itself throws', async () => {
    // Benign outcome → step 1 logs at info (not warn), so the only warn call is the
    // diagnostic in the catch block. Make BOTH the DB write and that warn throw.
    mockedPool.execute.mockRejectedValue(new Error('db down'));
    mockedLogger.warn.mockImplementationOnce(() => {
      throw new Error('logging pipe broke');
    });

    await expect(
      securityEventModel.record({
        event_type: SecurityEventType.STUB_AUTH_USED,
        outcome: SecurityOutcome.SUCCESS,
      }),
    ).resolves.toBeUndefined();

    // The diagnostic warn was attempted (and threw), but was swallowed internally.
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Failed to persist security event',
      expect.objectContaining({ event_type: SecurityEventType.STUB_AUTH_USED }),
    );
  });
});
