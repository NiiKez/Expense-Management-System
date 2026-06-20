import { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { Role } from '../../types';
import { userModel } from '../../models/user';

jest.mock('../../models/user', () => ({
  userModel: {
    findById: jest.fn(),
  },
}));

const mockedUserModel = userModel as jest.Mocked<typeof userModel>;

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
  });
});
