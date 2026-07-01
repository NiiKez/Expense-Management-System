import { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { Role, SecurityEventType, SecurityOutcome } from '../../types';
import { userModel } from '../../models/user';
import { securityEventModel } from '../../models/securityEvent';

jest.mock('../../models/user', () => ({
  userModel: {
    findById: jest.fn(),
  },
}));
jest.mock('../../models/securityEvent', () => ({
  securityEventModel: { record: jest.fn() },
}));

const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedSecurityEvent = securityEventModel as jest.Mocked<typeof securityEventModel>;

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:5173',
      'x-stub-user-id': '1',
    },
    socket: {
      remoteAddress: '::1',
    },
    ...overrides,
  } as Request;
}

describe('authenticate stub auth', () => {
  const originalEnv = { ...process.env };
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
      ALLOW_STUB_AUTH: 'true',
    };
    next = jest.fn();
    mockedUserModel.findById.mockResolvedValue({
      id: 1,
      entra_id: 'stub-entra-id',
      email: 'employee@test.com',
      display_name: 'Employee',
      role: Role.EMPLOYEE,
      manager_id: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('allows development stub auth from localhost without a browser-delivered secret', async () => {
    const req = makeRequest();

    await authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({
      id: 1,
      role: Role.EMPLOYEE,
      email: 'employee@test.com',
      stubAuth: true,
    });
    expect(mockedUserModel.findById).toHaveBeenCalledWith(1);
    // The dev stub path is recorded as a security event.
    expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: SecurityEventType.STUB_AUTH_USED,
        outcome: SecurityOutcome.SUCCESS,
        user_id: 1,
      }),
    );
  });

  it('rejects stub auth when the socket is not loopback', async () => {
    const req = makeRequest({
      socket: { remoteAddress: '10.0.0.5' } as Request['socket'],
    });

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Stub auth is only available from localhost');
    expect(mockedUserModel.findById).not.toHaveBeenCalled();
    // A rejected stub request is not a recorded security event.
    expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
  });

  // ── Environment gates: the ONLY thing keeping the "trust X-Stub-User-Id and
  // become any user" path out of prod is NODE_ENV=development AND ALLOW_STUB_AUTH.
  // A perfectly-formed loopback stub request must be COMPLETELY IGNORED (not
  // merely rejected with a stub-specific 401) when either gate is off — it falls
  // through to the real Entra path, which 401s on the (here absent) bearer token.
  describe('environment gates (the single most important stub negative test)', () => {
    it('IGNORES a valid loopback stub request under NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      const req = makeRequest(); // valid x-stub-user-id + loopback socket/host/origin

      await authenticate(req, {} as Response, next);

      // Fell through to Entra auth (no Authorization header on this req).
      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toMatch(/Authorization header/i);
      // Stub never ran: no impersonation, no DB lookup, no stub security event.
      expect(req.user).toBeUndefined();
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
      expect(mockedSecurityEvent.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: SecurityEventType.STUB_AUTH_USED }),
      );
    });

    it('IGNORES a valid loopback stub request in development when ALLOW_STUB_AUTH is unset', async () => {
      delete process.env.ALLOW_STUB_AUTH; // NODE_ENV stays 'development'
      const req = makeRequest();

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toMatch(/Authorization header/i);
      expect(req.user).toBeUndefined();
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
      expect(mockedSecurityEvent.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: SecurityEventType.STUB_AUTH_USED }),
      );
    });
  });

  // ── Loopback gate facets: isLocalStubRequest ANDs a loopback socket AND a local
  // Host AND a local Origin AND a local Referer. The socket facet is covered above;
  // here each of the header facets is proven to independently block a stub request
  // that arrives over a loopback socket.
  describe('loopback gate — host/origin/referer facets', () => {
    it('rejects a loopback-socket stub request with a non-local Host header', async () => {
      const req = makeRequest({
        headers: { host: 'evil.com', origin: 'http://localhost:5173', 'x-stub-user-id': '1' },
      });

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Stub auth is only available from localhost');
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    it('rejects a loopback-socket stub request with a non-local Origin header', async () => {
      const req = makeRequest({
        headers: { host: 'localhost:3000', origin: 'http://evil.com', 'x-stub-user-id': '1' },
      });

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Stub auth is only available from localhost');
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    it('rejects a loopback-socket stub request with a non-local Referer header', async () => {
      const req = makeRequest({
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:5173',
          referer: 'http://evil.com',
          'x-stub-user-id': '1',
        },
      });

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Stub auth is only available from localhost');
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });
  });

  // ── Stub-user-id validation (dev + allow + loopback all satisfied). ──────────
  describe('stub user id validation', () => {
    it('rejects a non-positive X-Stub-User-Id without a DB lookup', async () => {
      const req = makeRequest({
        headers: { host: 'localhost:3000', origin: 'http://localhost:5173', 'x-stub-user-id': '-1' },
      });

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Invalid X-Stub-User-Id header');
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    it('rejects a non-numeric X-Stub-User-Id without a DB lookup', async () => {
      const req = makeRequest({
        headers: { host: 'localhost:3000', origin: 'http://localhost:5173', 'x-stub-user-id': 'abc' },
      });

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Invalid X-Stub-User-Id header');
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    it('rejects when the stub user id does not resolve to a row', async () => {
      mockedUserModel.findById.mockResolvedValue(null);
      const req = makeRequest();

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Stub user not found');
      expect(mockedUserModel.findById).toHaveBeenCalledWith(1);
      expect(req.user).toBeUndefined();
    });

    it('rejects a deactivated stub user and never attaches req.user', async () => {
      mockedUserModel.findById.mockResolvedValue({
        id: 1,
        entra_id: 'stub-entra-id',
        email: 'employee@test.com',
        display_name: 'Employee',
        role: Role.EMPLOYEE,
        manager_id: null,
        is_active: false,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const req = makeRequest();

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('User account is deactivated');
      expect(req.user).toBeUndefined();
      // A deactivated stub identity must NOT be recorded as a successful stub use.
      expect(mockedSecurityEvent.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: SecurityEventType.STUB_AUTH_USED }),
      );
    });
  });
});
