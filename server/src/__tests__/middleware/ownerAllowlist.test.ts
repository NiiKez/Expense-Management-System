import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../../middleware/auth';
import { Role, SecurityEventType, SecurityOutcome } from '../../types';
import { userModel } from '../../models/user';
import { securityEventModel } from '../../models/securityEvent';

jest.mock('jsonwebtoken');
jest.mock('../../models/user', () => ({
  userModel: {
    upsertByEntraId: jest.fn(),
    updateRole: jest.fn(),
    findById: jest.fn(),
  },
}));
jest.mock('../../models/securityEvent', () => ({
  securityEventModel: { record: jest.fn() },
}));

const mockedJwt = jwt as jest.Mocked<typeof jwt>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedSecurityEvent = securityEventModel as jest.Mocked<typeof securityEventModel>;

function reqWithBearer(): Request {
  return {
    headers: { authorization: 'Bearer real.entra.token' },
    socket: { remoteAddress: '10.0.0.9' },
  } as unknown as Request;
}

// Make the (mocked) JWT verification resolve to an Entra payload with the given oid.
function mockVerify(oid: string): void {
  (mockedJwt.verify as unknown as jest.Mock).mockImplementation(
    (_token: string, _key: unknown, _opts: unknown, cb: (e: Error | null, d: unknown) => void) => {
      cb(null, { oid, preferred_username: 'owner@example.com', name: 'Owner', roles: [Role.ADMIN] });
    },
  );
}

describe('authenticate owner allowlist (OWNER_OIDS)', () => {
  const originalEnv = { ...process.env };
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    next = jest.fn();
    mockedUserModel.upsertByEntraId.mockResolvedValue({
      id: 1,
      entra_id: 'owner-oid',
      email: 'owner@example.com',
      display_name: 'Owner',
      role: Role.ADMIN,
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

  it('allows a user whose oid is in OWNER_OIDS', async () => {
    process.env.OWNER_OIDS = 'owner-oid, other-oid';
    mockVerify('owner-oid');
    const req = reqWithBearer();

    await authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: 1, role: Role.ADMIN });
    // Happy path: the stored role already matches the token, so no security
    // event is recorded — proves we never write a row on the success path.
    expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
  });

  it('matches OWNER_OIDS case-insensitively (GUID casing must not lock the owner out)', async () => {
    process.env.OWNER_OIDS = 'OWNER-OID, OTHER-OID';
    mockVerify('owner-oid');
    const req = reqWithBearer();

    await authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: 1, role: Role.ADMIN });
  });

  it('rejects a user whose oid is not in OWNER_OIDS', async () => {
    process.env.OWNER_OIDS = 'owner-oid';
    mockVerify('intruder-oid');
    const req = reqWithBearer();

    await authenticate(req, {} as Response, next);

    const err = next.mock.calls[0][0] as { statusCode?: number };
    expect(err.statusCode).toBe(403);
    expect(req.user).toBeUndefined();
    expect(mockedUserModel.upsertByEntraId).not.toHaveBeenCalled();
    // The allowlist rejection is recorded as an ACCESS_DENIED security event.
    expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: SecurityEventType.ACCESS_DENIED,
        outcome: SecurityOutcome.FAILURE,
        entra_oid: 'intruder-oid',
      }),
    );
  });

  it('allows any valid user when OWNER_OIDS is unset (default behavior)', async () => {
    delete process.env.OWNER_OIDS;
    mockVerify('anybody-oid');
    const req = reqWithBearer();

    await authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: 1 });
  });
});
