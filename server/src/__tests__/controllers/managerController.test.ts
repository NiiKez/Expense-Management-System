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
    assignedRoles: [Role.MANAGER],
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
        jobTitle: 'Engineer',
        department: 'Engineering',
        employeeId: 'E-1',
        officeLocation: 'Berlin',
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
    mockedUserModel.reassignManagerForUsers.mockResolvedValue(undefined);
    mockedUserModel.syncOrgAttributesForUsers.mockResolvedValue(undefined);

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
    });
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(mockedGraphApiService.getDirectReports).toHaveBeenCalledWith(2, 'token-123', { forceRefresh: false });
    expect(mockedUserModel.findByEntraIds).toHaveBeenCalledWith(['entra-employee']);
    expect(mockedUserModel.reassignManagerForUsers).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 7, manager_id: null })],
      2,
    );
    // Matched reports' Graph org attrs are persisted onto their rows.
    expect(mockedUserModel.syncOrgAttributesForUsers).toHaveBeenCalledWith([
      { id: 7, department: 'Engineering', job_title: 'Engineer', employee_id: 'E-1', office_location: 'Berlin' },
    ]);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          id: 'entra-employee',
          displayName: 'Employee One',
          mail: 'employee@test.com',
          userPrincipalName: 'employee@test.com',
          jobTitle: 'Engineer',
          department: 'Engineering',
          employeeId: 'E-1',
          officeLocation: 'Berlin',
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
          jobTitle: null,
          department: null,
          employeeId: null,
          officeLocation: null,
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

  it('maps org attributes from the user row on the database fallback', async () => {
    mockedUserModel.findByManagerId.mockResolvedValue([
      {
        id: 9,
        entra_id: 'entra-local',
        email: 'local.employee@test.com',
        display_name: 'Local Employee',
        role: Role.EMPLOYEE,
        manager_id: 2,
        is_active: true,
        department: 'Finance',
        job_title: 'Analyst',
        employee_id: 'E-9',
        office_location: 'Madrid',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const req = mockRequest();
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    const record = (res.json as jest.Mock).mock.calls[0][0].data[0];
    expect(record.jobTitle).toBe('Analyst');
    expect(record.department).toBe('Finance');
    expect(record.employeeId).toBe('E-9');
    expect(record.officeLocation).toBe('Madrid');
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
          jobTitle: null,
          department: null,
          employeeId: null,
          officeLocation: null,
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
          jobTitle: null,
          department: null,
          employeeId: null,
          officeLocation: null,
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

  it('falls back to the database with graph_no_direct_reports when Graph returns an empty team', async () => {
    mockedGraphApiService.getDirectReports.mockResolvedValue([]);
    mockedUserModel.findByManagerId.mockResolvedValue([]);

    const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(mockedUserModel.findByManagerId).toHaveBeenCalledWith(2);
    // The empty-Graph branch must not touch the reconciliation/reassign path.
    expect(mockedUserModel.findByEntraIds).not.toHaveBeenCalled();
    expect(mockedUserModel.reassignManagerForUsers).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [],
      meta: {
        source: 'database',
        reason: 'graph_no_direct_reports',
        forceRefresh: false,
      },
    });
  });

  it('serves a demo session from the database without ever calling Graph (even with a token)', async () => {
    mockedUserModel.findByManagerId.mockResolvedValue([]);

    const req = mockRequest({
      user: {
        id: 2,
        role: Role.MANAGER,
        assignedRoles: [Role.MANAGER],
        email: 'manager@test.com',
        display_name: 'Manager',
        demoMode: true,
      },
      headers: { authorization: 'Bearer token-123' },
    });
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(mockedGraphApiService.getDirectReports).not.toHaveBeenCalled();
    expect(mockedUserModel.findByManagerId).toHaveBeenCalledWith(2);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [],
      meta: { source: 'database', reason: 'missing_token', forceRefresh: false },
    });
  });

  it('sets appUser to null for a Graph report with no matching app-user row', async () => {
    mockedGraphApiService.getDirectReports.mockResolvedValue([
      {
        id: 'entra-a',
        displayName: 'Report A',
        mail: 'a@test.com',
        userPrincipalName: 'a@test.com',
        jobTitle: null,
        department: null,
        employeeId: null,
        officeLocation: null,
      },
      {
        id: 'entra-b',
        displayName: 'Report B',
        mail: 'b@test.com',
        userPrincipalName: 'b@test.com',
        jobTitle: null,
        department: null,
        employeeId: null,
        officeLocation: null,
      },
    ]);
    // Only entra-a is provisioned as an app user; entra-b has no matching row.
    mockedUserModel.findByEntraIds.mockResolvedValue([
      {
        id: 7,
        entra_id: 'entra-a',
        email: 'a@test.com',
        display_name: 'Report A',
        role: Role.EMPLOYEE,
        manager_id: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    mockedUserModel.reassignManagerForUsers.mockResolvedValue(undefined);
    mockedUserModel.syncOrgAttributesForUsers.mockResolvedValue(undefined);

    const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual(expect.objectContaining({ id: 'entra-a', appUser: expect.objectContaining({ id: 7 }) }));
    expect(data[1]).toEqual(expect.objectContaining({ id: 'entra-b', appUser: null }));
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards an outer error to next when the database fallback query throws', async () => {
    const dbError = new Error('user directory unavailable');
    mockedUserModel.findByManagerId.mockRejectedValue(dbError);

    // No bearer token → DB fallback path, whose rejection reaches the outer catch.
    const req = mockRequest();
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('forwards forceRefresh=true to Graph and echoes it in the response meta', async () => {
    mockedGraphApiService.getDirectReports.mockResolvedValue([]);
    mockedUserModel.findByManagerId.mockResolvedValue([]);

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
      query: { forceRefresh: 'true' },
    });
    const res = mockResponse();

    await getManagerEmployees(req as Request, res as Response, next);

    expect(mockedGraphApiService.getDirectReports).toHaveBeenCalledWith(2, 'token-123', { forceRefresh: true });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ forceRefresh: true }),
    }));
  });
});
