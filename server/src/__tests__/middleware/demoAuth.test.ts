import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../../middleware/auth';
import { Role, User } from '../../types';
import { userModel } from '../../models/user';

jest.mock('../../models/user', () => ({
  userModel: {
    findById: jest.fn(),
  },
}));

const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const DEMO_SECRET = 'test-demo-secret-please-ignore';

function demoUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    entra_id: 'demo-uuid',
    email: 'demo.user@demo.local',
    display_name: 'Demo User',
    role: Role.MANAGER,
    manager_id: null,
    is_active: true,
    is_demo: 1,
    demo_expires_at: new Date(Date.now() + 3_600_000),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function signDemo(payload: object): string {
  return jwt.sign(payload, DEMO_SECRET, { algorithm: 'HS256', expiresIn: 3600 });
}

function reqWithToken(token: string): Request {
  return {
    headers: { authorization: `Bearer ${token}` },
    // Deliberately non-loopback so the stub path can never be the thing that passes.
    socket: { remoteAddress: '10.0.0.9' },
  } as unknown as Request;
}

describe('authenticate demo auth', () => {
  const originalEnv = { ...process.env };
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      ENABLE_DEMO: 'true',
      DEMO_JWT_SECRET: DEMO_SECRET,
    };
    next = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('authenticates a valid demo token as a demo session', async () => {
    mockedUserModel.findById.mockResolvedValue(demoUser());
    const req = reqWithToken(signDemo({ sub: '42', demo: true, role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: 42, role: Role.MANAGER, demoMode: true });
  });

  it('carries the workspace id (demo_session_id) onto req.user for scoping', async () => {
    mockedUserModel.findById.mockResolvedValue(demoUser({ demo_session_id: 'sess-abc' }));
    const req = reqWithToken(signDemo({ sub: '42', demo: true, role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user?.demoSessionId).toBe('sess-abc');
  });

  it('rejects a demo token whose user row is not flagged is_demo', async () => {
    // A forged demo token pointing at a real user's id must not impersonate them.
    mockedUserModel.findById.mockResolvedValue(demoUser({ is_demo: 0 }));
    const req = reqWithToken(signDemo({ sub: '42', demo: true, role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number };
    expect(err.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
  });

  it('rejects an expired demo workspace even with an unexpired token', async () => {
    mockedUserModel.findById.mockResolvedValue(demoUser({ demo_expires_at: new Date(Date.now() - 1000) }));
    const req = reqWithToken(signDemo({ sub: '42', demo: true, role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Demo session has expired');
  });

  it('does not honor a demo token when ENABLE_DEMO is off', async () => {
    process.env.ENABLE_DEMO = 'false';
    mockedUserModel.findById.mockResolvedValue(demoUser());
    const req = reqWithToken(signDemo({ sub: '42', demo: true, role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    // Falls through to the Entra path, which rejects the HS256 token outright.
    const err = next.mock.calls[0][0] as { statusCode?: number };
    expect(err.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
    expect(mockedUserModel.findById).not.toHaveBeenCalled();
  });

  it('ignores a same-secret token that lacks the demo claim', async () => {
    mockedUserModel.findById.mockResolvedValue(demoUser());
    const req = reqWithToken(signDemo({ sub: '42', role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number };
    expect(err.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
    expect(mockedUserModel.findById).not.toHaveBeenCalled();
  });

  it('rejects a demo token whose user row is deactivated', async () => {
    mockedUserModel.findById.mockResolvedValue(demoUser({ is_active: false }));
    const req = reqWithToken(signDemo({ sub: '42', demo: true, role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('User account is deactivated');
    expect(req.user).toBeUndefined();
  });

  it.each(['abc', '0', '-4', '1.5'])(
    'rejects a demo token with a non-positive-integer sub (%p) without a DB lookup',
    async (sub) => {
      const req = reqWithToken(signDemo({ sub, demo: true, role: Role.MANAGER }));

      await authenticate(req, {} as Response, next);

      const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Invalid demo token');
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
    },
  );

  it('rejects a demo token whose user row was already reaped', async () => {
    mockedUserModel.findById.mockResolvedValue(null);
    const req = reqWithToken(signDemo({ sub: '42', demo: true, role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Demo session is no longer valid');
    expect(req.user).toBeUndefined();
  });

  it('maps a null demo_session_id to an undefined demoSessionId (so demoScope fails closed)', async () => {
    mockedUserModel.findById.mockResolvedValue(demoUser({ demo_session_id: null }));
    const req = reqWithToken(signDemo({ sub: '42', demo: true, role: Role.MANAGER }));

    await authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user?.demoMode).toBe(true);
    expect(req.user?.demoSessionId).toBeUndefined();
  });

  it('falls through (no demo lookup) for an oversized Bearer header', async () => {
    // The demo path caps the header at 8192 chars before doing any work, so a
    // giant token can't force a verify/DB lookup. It falls through to Entra,
    // whose own length guard 401s it up front.
    mockedUserModel.findById.mockResolvedValue(demoUser());
    const req = reqWithToken('x'.repeat(9000)); // "Bearer " + 9000 = 9007 > 8192

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
    expect(mockedUserModel.findById).not.toHaveBeenCalled();
  });

  it('rejects an expired demo token without ever looking up (or attaching) the user', async () => {
    // Even though the row is a perfectly valid, unexpired demo workspace, an
    // EXPIRED token must not authenticate: verification fails, the demo path
    // falls through, and Entra then 401s the HS256 token. If exp were ignored,
    // findById would run and req.user would be set — so this pins the exp check.
    mockedUserModel.findById.mockResolvedValue(demoUser());
    const expired = jwt.sign(
      { sub: '42', demo: true, role: Role.MANAGER },
      DEMO_SECRET,
      { algorithm: 'HS256', expiresIn: -10 },
    );
    const req = reqWithToken(expired);

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number };
    expect(err.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
    expect(mockedUserModel.findById).not.toHaveBeenCalled();
  });

  it('falls through to Entra for a token not signed by the demo secret', async () => {
    // A token signed with a different secret can't be a demo token; it must not be
    // treated as one, and no demo DB lookup should happen — it falls to Entra auth
    // (which then rejects the non-RS256 token).
    const foreign = jwt.sign({ sub: '42', demo: true, role: Role.MANAGER }, 'a-different-secret', {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    const req = reqWithToken(foreign);

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number };
    expect(err.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
    expect(mockedUserModel.findById).not.toHaveBeenCalled();
  });
});
