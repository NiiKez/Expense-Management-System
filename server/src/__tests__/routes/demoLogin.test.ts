import { Request, Response, NextFunction } from 'express';
import { demoLogin } from '../../routes/auth';
import { isDemoEnabled } from '../../config/demo';
import { canCreateDemoWorkspace, createDemoWorkspace, signDemoToken } from '../../services/demoService';
import { securityEventModel } from '../../models/securityEvent';
import { Role, SecurityEventType, SecurityOutcome } from '../../types';

jest.mock('../../config/demo', () => ({
  isDemoEnabled: jest.fn(),
}));
jest.mock('../../services/demoService', () => ({
  canCreateDemoWorkspace: jest.fn(),
  createDemoWorkspace: jest.fn(),
  signDemoToken: jest.fn(),
}));
jest.mock('../../models/securityEvent', () => ({
  securityEventModel: { record: jest.fn() },
}));

const mockedIsDemoEnabled = isDemoEnabled as jest.MockedFunction<typeof isDemoEnabled>;
const mockedCanCreate = canCreateDemoWorkspace as jest.MockedFunction<typeof canCreateDemoWorkspace>;
const mockedCreate = createDemoWorkspace as jest.MockedFunction<typeof createDemoWorkspace>;
const mockedSign = signDemoToken as jest.MockedFunction<typeof signDemoToken>;
const mockedSecurityEvent = securityEventModel as jest.Mocked<typeof securityEventModel>;

function makeRes(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('demoLogin route', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('rejects with 403 when demo mode is disabled', async () => {
    mockedIsDemoEnabled.mockReturnValue(false);

    await demoLogin({} as Request, makeRes(), next);

    const err = next.mock.calls[0][0] as { statusCode?: number };
    expect(err.statusCode).toBe(403);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects with 503 when at capacity', async () => {
    mockedIsDemoEnabled.mockReturnValue(true);
    mockedCanCreate.mockResolvedValue(false);

    await demoLogin({} as Request, makeRes(), next);

    const err = next.mock.calls[0][0] as { statusCode?: number };
    expect(err.statusCode).toBe(503);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  const workspace = {
    sessionId: 'sess-abc',
    expiresAt: new Date('2026-01-01T00:00:00Z'),
    usersByRole: { [Role.ADMIN]: 5, [Role.MANAGER]: 7, [Role.EMPLOYEE]: 9 },
  };

  it('defaults to the MANAGER role and returns a token when no body is sent', async () => {
    mockedIsDemoEnabled.mockReturnValue(true);
    mockedCanCreate.mockResolvedValue(true);
    mockedCreate.mockResolvedValue(workspace);
    mockedSign.mockReturnValue('signed.demo.jwt');
    const res = makeRes();

    await demoLogin({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { token: 'signed.demo.jwt' },
    });
    // The MANAGER workspace user is the one signed.
    expect(mockedSign).toHaveBeenCalledWith(7, Role.MANAGER);
    // Issuing a demo session is recorded as a security event for the chosen role.
    expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: SecurityEventType.DEMO_SESSION_ISSUED,
        outcome: SecurityOutcome.SUCCESS,
        user_id: 7,
        role: Role.MANAGER,
      }),
    );
    // Issuing a demo session is recorded as a security event.
    expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: SecurityEventType.DEMO_SESSION_ISSUED,
        outcome: SecurityOutcome.SUCCESS,
        user_id: 7,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('mints a token for the requested role from the body', async () => {
    mockedIsDemoEnabled.mockReturnValue(true);
    mockedCanCreate.mockResolvedValue(true);
    mockedCreate.mockResolvedValue(workspace);
    mockedSign.mockReturnValue('signed.admin.jwt');
    const res = makeRes();

    await demoLogin({ body: { role: 'ADMIN' } } as Request, res, next);

    expect(mockedSign).toHaveBeenCalledWith(5, Role.ADMIN);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { token: 'signed.admin.jwt' },
    });
    expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 5, role: Role.ADMIN }),
    );
  });

  it('falls back to MANAGER when the requested role is invalid', async () => {
    mockedIsDemoEnabled.mockReturnValue(true);
    mockedCanCreate.mockResolvedValue(true);
    mockedCreate.mockResolvedValue(workspace);
    mockedSign.mockReturnValue('signed.demo.jwt');

    await demoLogin({ body: { role: 'SUPERUSER' } } as Request, makeRes(), next);

    expect(mockedSign).toHaveBeenCalledWith(7, Role.MANAGER);
    expect(next).not.toHaveBeenCalled();
  });
});
