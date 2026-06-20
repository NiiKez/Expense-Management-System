import { Request, Response, NextFunction } from 'express';
import { getManagerEmployees } from '../../controllers/managerController';
import { GraphApiAuthError, graphApiService, isGraphApiAuthError } from '../../services/graphApi';
import { userModel } from '../../models/user';
import { Role } from '../../types';

jest.mock('../../services/graphApi');
jest.mock('../../models/user');

const mockedGraphApiService = graphApiService as jest.Mocked<typeof graphApiService>;
const mockedIsGraphApiAuthError = isGraphApiAuthError as jest.MockedFunction<typeof isGraphApiAuthError>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  user: {
    id: 2,
    role: Role.MANAGER,
    email: 'manager@test.com',
    display_name: 'Manager',
  },
  headers: {},
  query: {},
  ...overrides,
});

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('managerController', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
    mockedIsGraphApiAuthError.mockReturnValue(false);
  });

  it('returns Graph direct reports and matched app users', async () => {
    mockedGraphApiService.getDirectReports.mockResolvedValue([
      {
        id: 'entra-employee',
        displayName: 'Employee One',
        mail: 'employee@test.com',
        userPrincipalName: 'employee@test.com',
      },
    ]);
    mockedUserModel.findByEntraIds.mockResolvedValue([
      {
        id: 7,
        entra_id: 'entra-employee',
        email: 'employee@test.com',
        display_name: 'Employee One',
        role: Role.EMPLOYEE,
        manager_id: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    mockedUserModel.updateManager.mockResolvedValue(null);

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
    });
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(mockedGraphApiService.getDirectReports).toHaveBeenCalledWith(2, 'token-123', { forceRefresh: false });
    expect(mockedUserModel.findByEntraIds).toHaveBeenCalledWith(['entra-employee']);
    expect(mockedUserModel.updateManager).toHaveBeenCalledWith(7, 2);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          id: 'entra-employee',
          displayName: 'Employee One',
          mail: 'employee@test.com',
          userPrincipalName: 'employee@test.com',
          appUser: {
            id: 7,
            email: 'employee@test.com',
            display_name: 'Employee One',
            role: Role.EMPLOYEE,
            manager_id: 2,
            is_active: true,
          },
        },
      ],
      meta: {
        source: 'graph',
        forceRefresh: false,
      },
    });
  });

  it('falls back to database-managed users when no bearer token is present', async () => {
    mockedUserModel.findByManagerId.mockResolvedValue([
      {
        id: 9,
        entra_id: 'entra-local',
        email: 'local.employee@test.com',
        display_name: 'Local Employee',
        role: Role.EMPLOYEE,
        manager_id: 2,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const req = mockRequest();
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(mockedUserModel.findByManagerId).toHaveBeenCalledWith(2);
    expect(mockedGraphApiService.getDirectReports).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          id: 'entra-local',
          displayName: 'Local Employee',
          mail: 'local.employee@test.com',
          userPrincipalName: 'local.employee@test.com',
          appUser: {
            id: 9,
            email: 'local.employee@test.com',
            display_name: 'Local Employee',
            role: Role.EMPLOYEE,
            manager_id: 2,
            is_active: true,
          },
        },
      ],
      meta: {
        source: 'database',
        reason: 'missing_token',
        forceRefresh: false,
      },
    });
  });

  it('falls back to database-managed users when Graph lookup fails', async () => {
    mockedGraphApiService.getDirectReports.mockRejectedValue(new Error('Graph unavailable'));
    mockedUserModel.findByManagerId.mockResolvedValue([
      {
        id: 9,
        entra_id: 'entra-local',
        email: 'local.employee@test.com',
        display_name: 'Local Employee',
        role: Role.EMPLOYEE,
        manager_id: 2,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
    });
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(mockedGraphApiService.getDirectReports).toHaveBeenCalledWith(2, 'token-123', { forceRefresh: false });
    expect(mockedUserModel.findByManagerId).toHaveBeenCalledWith(2);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          id: 'entra-local',
          displayName: 'Local Employee',
          mail: 'local.employee@test.com',
          userPrincipalName: 'local.employee@test.com',
          appUser: {
            id: 9,
            email: 'local.employee@test.com',
            display_name: 'Local Employee',
            role: Role.EMPLOYEE,
            manager_id: 2,
            is_active: true,
          },
        },
      ],
      meta: {
        source: 'database',
        reason: 'graph_unavailable',
        forceRefresh: false,
      },
    });
  });

  it('returns a consent-specific fallback reason when Graph delegated consent is missing', async () => {
    mockedGraphApiService.getDirectReports.mockRejectedValue({
      name: 'GraphApiAuthError',
      reason: 'consent_required',
    } as GraphApiAuthError);
    mockedIsGraphApiAuthError.mockReturnValue(true);
    mockedUserModel.findByManagerId.mockResolvedValue([
      {
        id: 9,
        entra_id: 'entra-local',
        email: 'local.employee@test.com',
        display_name: 'Local Employee',
        role: Role.EMPLOYEE,
        manager_id: 2,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
    });
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          id: 'entra-local',
          displayName: 'Local Employee',
          mail: 'local.employee@test.com',
          userPrincipalName: 'local.employee@test.com',
          appUser: {
            id: 9,
            email: 'local.employee@test.com',
            display_name: 'Local Employee',
            role: Role.EMPLOYEE,
            manager_id: 2,
            is_active: true,
          },
        },
      ],
      meta: {
        source: 'database',
        reason: 'graph_consent_required',
        forceRefresh: false,
      },
    });
  });
});
