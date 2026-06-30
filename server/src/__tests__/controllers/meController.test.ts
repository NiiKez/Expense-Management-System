import { Request, Response, NextFunction } from 'express';
import { getMe, getMyDirectory, updateMyPreferences } from '../../controllers/meController';
import { userModel } from '../../models/user';
import { GraphApiAuthError, GraphGroup, GraphUser, graphApiService, isGraphApiAuthError } from '../../services/graphApi';
import { Role, User } from '../../types';
import { AppError } from '../../utils/errors';

jest.mock('../../models/user');
jest.mock('../../services/graphApi');

const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedGraphApiService = graphApiService as jest.Mocked<typeof graphApiService>;
const mockedIsGraphApiAuthError = isGraphApiAuthError as jest.MockedFunction<typeof isGraphApiAuthError>;

const mockGraphUser = (overrides: Partial<GraphUser> = {}): GraphUser => ({
  id: 'entra-x',
  displayName: 'Graph User',
  mail: 'graph@test.com',
  userPrincipalName: 'graph@test.com',
  jobTitle: null,
  department: null,
  employeeId: null,
  officeLocation: null,
  ...overrides,
});

const CALLER_ID = 3;

const mockUserRow = (overrides: Partial<User> = {}): User => ({
  id: CALLER_ID,
  entra_id: 'entra-3',
  email: 'me@test.com',
  display_name: 'Me',
  role: Role.EMPLOYEE,
  manager_id: null,
  is_active: true,
  // MySQL returns BOOLEAN columns as 0/1 — exercise the controller's coercion.
  default_currency: 'EUR',
  notify_on_submission: 1,
  notify_on_decision: 0,
  notify_on_comment: 1,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  user: { id: CALLER_ID, role: Role.EMPLOYEE, assignedRoles: [Role.EMPLOYEE], email: 'me@test.com', display_name: 'Me' },
  headers: {},
  params: {},
  body: {},
  query: {},
  ...overrides,
});

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('meController', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.resetAllMocks();
    // Sensible defaults: no cached groups, and the auth-error type-guard is false
    // unless a test opts in. Set after resetAllMocks so they survive the reset.
    mockedUserModel.getUserGroups.mockResolvedValue([]);
    mockedIsGraphApiAuthError.mockReturnValue(false);
  });

  // ────────────────────────────────────────────────────────────────
  // getMe
  // ────────────────────────────────────────────────────────────────

  describe('getMe', () => {
    it('returns 404 when the caller row is gone', async () => {
      mockedUserModel.findById.mockResolvedValue(null);

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(mockedUserModel.findById).toHaveBeenCalledWith(CALLER_ID);
      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('serializes the caller and coerces 0/1 preference flags to real booleans', async () => {
      mockedUserModel.findById.mockResolvedValue(mockUserRow());

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(mockedUserModel.findById).toHaveBeenCalledWith(CALLER_ID);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: CALLER_ID,
          email: 'me@test.com',
          role: Role.EMPLOYEE,
          // Full assigned-role set, surfaced for the client's role picker.
          roles: [Role.EMPLOYEE],
          manager_id: null,
          manager_name: null,
          default_currency: 'EUR',
          notify_on_submission: true, // 1 -> true
          notify_on_decision: false, // 0 -> false
          notify_on_comment: true, // 1 -> true
        }),
      });
      // Booleans must be real primitives, not 1/0.
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.notify_on_decision).toStrictEqual(false);
      expect(payload.notify_on_submission).toStrictEqual(true);
    });

    it('surfaces org attributes (camelCase) and cached groups from the row', async () => {
      mockedUserModel.findById.mockResolvedValue(
        mockUserRow({
          department: 'Engineering',
          job_title: 'Senior Engineer',
          employee_id: 'E-100',
          office_location: 'Berlin',
        }),
      );
      mockedUserModel.getUserGroups.mockResolvedValue([
        { group_id: 'g1', group_name: 'All Engineers' },
        { group_id: 'g2', group_name: null },
      ]);

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(mockedUserModel.getUserGroups).toHaveBeenCalledWith(CALLER_ID);
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.department).toBe('Engineering');
      expect(payload.jobTitle).toBe('Senior Engineer');
      expect(payload.employeeId).toBe('E-100');
      expect(payload.officeLocation).toBe('Berlin');
      expect(payload.groups).toEqual([
        { id: 'g1', name: 'All Engineers' },
        { id: 'g2', name: null },
      ]);
    });

    it('defaults org attributes to null and groups to [] when absent', async () => {
      mockedUserModel.findById.mockResolvedValue(mockUserRow());

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.department).toBeNull();
      expect(payload.jobTitle).toBeNull();
      expect(payload.employeeId).toBeNull();
      expect(payload.officeLocation).toBeNull();
      expect(payload.groups).toEqual([]);
    });

    it('reflects the ACTIVE role and full assigned set from req.user, not the DB row', async () => {
      // DB row carries the canonical (highest) role; req.user carries the active
      // role for this request (here switched down to MANAGER) plus the held set.
      mockedUserModel.findById.mockResolvedValue(mockUserRow({ role: Role.ADMIN }));

      const req = mockRequest({
        user: {
          id: CALLER_ID,
          role: Role.MANAGER, // active (switched-down) role
          assignedRoles: [Role.ADMIN, Role.MANAGER],
          email: 'me@test.com',
          display_name: 'Me',
        },
      });
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.role).toBe(Role.MANAGER); // active, NOT the DB's ADMIN
      expect(payload.roles).toEqual([Role.ADMIN, Role.MANAGER]);
    });

    it('defaults absent preference flags to true (column DEFAULT TRUE)', async () => {
      mockedUserModel.findById.mockResolvedValue(
        mockUserRow({
          default_currency: undefined,
          notify_on_submission: undefined,
          notify_on_decision: undefined,
          notify_on_comment: undefined,
        }),
      );

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.default_currency).toBeNull();
      expect(payload.notify_on_submission).toBe(true);
      expect(payload.notify_on_decision).toBe(true);
      expect(payload.notify_on_comment).toBe(true);
    });

    it('resolves the manager display name for the read-only profile section', async () => {
      mockedUserModel.findById
        .mockResolvedValueOnce(mockUserRow({ manager_id: 8 }))
        .mockResolvedValueOnce(mockUserRow({ id: 8, display_name: 'Boss', manager_id: null }));

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(mockedUserModel.findById).toHaveBeenNthCalledWith(1, CALLER_ID);
      expect(mockedUserModel.findById).toHaveBeenNthCalledWith(2, 8);
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.manager_id).toBe(8);
      expect(payload.manager_name).toBe('Boss');
    });

    it('leaves manager_name null when the manager row cannot be loaded', async () => {
      mockedUserModel.findById
        .mockResolvedValueOnce(mockUserRow({ manager_id: 8 }))
        .mockResolvedValueOnce(null);

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.manager_name).toBeNull();
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('user lookup failed');
      mockedUserModel.findById.mockRejectedValue(dbError);

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getMyDirectory
  // ────────────────────────────────────────────────────────────────

  describe('getMyDirectory', () => {
    it('fetches the live directory from Graph, persists it, and reports source graph', async () => {
      mockedGraphApiService.getMyOrgProfile.mockResolvedValue(
        mockGraphUser({ jobTitle: 'Senior Engineer', department: 'Engineering', employeeId: 'E-1', officeLocation: 'Berlin' }),
      );
      mockedGraphApiService.getManagerChain.mockResolvedValue([
        mockGraphUser({ id: 'mgr-1', displayName: 'Direct Boss', jobTitle: 'Eng Manager', department: 'Engineering' }),
        mockGraphUser({ id: 'mgr-2', displayName: 'Skip Boss', jobTitle: 'Director', department: 'Engineering' }),
      ]);
      const graphGroups: GraphGroup[] = [
        { id: 'g1', displayName: 'All Engineers' },
        { id: 'g2', displayName: null },
      ];
      mockedGraphApiService.getGroupMemberships.mockResolvedValue(graphGroups);
      mockedUserModel.setOrgAttributes.mockResolvedValue(undefined);
      mockedUserModel.replaceUserGroups.mockResolvedValue(undefined);

      const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });
      const res = mockResponse();

      await getMyDirectory(req as Request, res as Response, next);

      expect(mockedGraphApiService.getMyOrgProfile).toHaveBeenCalledWith(CALLER_ID, 'token-123');
      expect(mockedGraphApiService.getManagerChain).toHaveBeenCalledWith(CALLER_ID, 'token-123');
      expect(mockedGraphApiService.getGroupMemberships).toHaveBeenCalledWith(CALLER_ID, 'token-123');

      // Persists self org attrs (snake_case for the model) and replaces groups.
      expect(mockedUserModel.setOrgAttributes).toHaveBeenCalledWith(CALLER_ID, {
        department: 'Engineering',
        job_title: 'Senior Engineer',
        employee_id: 'E-1',
        office_location: 'Berlin',
      });
      expect(mockedUserModel.replaceUserGroups).toHaveBeenCalledWith(CALLER_ID, [
        { group_id: 'g1', group_name: 'All Engineers' },
        { group_id: 'g2', group_name: null },
      ]);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          orgAttributes: {
            department: 'Engineering',
            jobTitle: 'Senior Engineer',
            employeeId: 'E-1',
            officeLocation: 'Berlin',
          },
          managerChain: [
            { id: 'mgr-1', displayName: 'Direct Boss', jobTitle: 'Eng Manager', department: 'Engineering' },
            { id: 'mgr-2', displayName: 'Skip Boss', jobTitle: 'Director', department: 'Engineering' },
          ],
          groups: [
            { id: 'g1', name: 'All Engineers' },
            { id: 'g2', name: null },
          ],
        },
        meta: { source: 'graph' },
      });
    });

    it('falls back to the DB with a single-hop chain when no bearer token is present', async () => {
      mockedUserModel.findById
        .mockResolvedValueOnce(
          mockUserRow({ manager_id: 8, department: 'Engineering', job_title: 'Engineer', employee_id: 'E-7', office_location: 'Paris' }),
        )
        .mockResolvedValueOnce(
          mockUserRow({ id: 8, entra_id: 'entra-8', display_name: 'Boss', job_title: 'Manager', department: 'Engineering', manager_id: null }),
        );
      mockedUserModel.getUserGroups.mockResolvedValue([{ group_id: 'g1', group_name: 'All Engineers' }]);

      const req = mockRequest();
      const res = mockResponse();

      await getMyDirectory(req as Request, res as Response, next);

      expect(mockedGraphApiService.getMyOrgProfile).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          orgAttributes: {
            department: 'Engineering',
            jobTitle: 'Engineer',
            employeeId: 'E-7',
            officeLocation: 'Paris',
          },
          managerChain: [
            { id: 'entra-8', displayName: 'Boss', jobTitle: 'Manager', department: 'Engineering' },
          ],
          groups: [{ id: 'g1', name: 'All Engineers' }],
        },
        meta: { source: 'database', reason: 'missing_token' },
      });
    });

    it('serves a demo session from the DB without calling Graph (empty chain when no manager)', async () => {
      mockedUserModel.findById.mockResolvedValue(mockUserRow({ manager_id: null }));
      mockedUserModel.getUserGroups.mockResolvedValue([]);

      const req = mockRequest({
        user: { id: CALLER_ID, role: Role.EMPLOYEE, assignedRoles: [Role.EMPLOYEE], email: 'me@test.com', display_name: 'Me', demoMode: true },
        headers: { authorization: 'Bearer token-123' },
      });
      const res = mockResponse();

      await getMyDirectory(req as Request, res as Response, next);

      expect(mockedGraphApiService.getMyOrgProfile).not.toHaveBeenCalled();
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.managerChain).toEqual([]);
      expect(body.meta).toEqual({ source: 'database', reason: 'missing_token' });
    });

    it('falls back to the DB with graph_unavailable when Graph throws', async () => {
      mockedGraphApiService.getMyOrgProfile.mockRejectedValue(new Error('graph down'));
      mockedGraphApiService.getManagerChain.mockResolvedValue([]);
      mockedGraphApiService.getGroupMemberships.mockResolvedValue([]);
      mockedUserModel.findById.mockResolvedValue(mockUserRow({ manager_id: null }));
      mockedUserModel.getUserGroups.mockResolvedValue([]);

      const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });
      const res = mockResponse();

      await getMyDirectory(req as Request, res as Response, next);

      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.meta).toEqual({ source: 'database', reason: 'graph_unavailable' });
      // Nothing persisted on the failure path.
      expect(mockedUserModel.setOrgAttributes).not.toHaveBeenCalled();
      expect(mockedUserModel.replaceUserGroups).not.toHaveBeenCalled();
    });

    it('maps a consent failure to graph_consent_required', async () => {
      mockedGraphApiService.getMyOrgProfile.mockRejectedValue({
        name: 'GraphApiAuthError',
        reason: 'consent_required',
      } as GraphApiAuthError);
      mockedGraphApiService.getManagerChain.mockResolvedValue([]);
      mockedGraphApiService.getGroupMemberships.mockResolvedValue([]);
      mockedIsGraphApiAuthError.mockReturnValue(true);
      mockedUserModel.findById.mockResolvedValue(mockUserRow({ manager_id: null }));
      mockedUserModel.getUserGroups.mockResolvedValue([]);

      const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });
      const res = mockResponse();

      await getMyDirectory(req as Request, res as Response, next);

      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.meta).toEqual({ source: 'database', reason: 'graph_consent_required' });
    });

    it('returns 404 via next when the caller row is gone on the DB path', async () => {
      mockedUserModel.findById.mockResolvedValue(null);

      const req = mockRequest();
      const res = mockResponse();

      await getMyDirectory(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // updateMyPreferences
  // ────────────────────────────────────────────────────────────────

  describe('updateMyPreferences', () => {
    it('returns 404 when the caller row is gone', async () => {
      mockedUserModel.updatePreferences.mockResolvedValue(null);

      const req = mockRequest({ body: { notify_on_comment: false } });
      const res = mockResponse();

      await updateMyPreferences(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('updates the caller\'s own preferences and returns coerced booleans', async () => {
      const body = { notify_on_comment: false, default_currency: 'GBP' };
      mockedUserModel.updatePreferences.mockResolvedValue(
        mockUserRow({
          default_currency: 'GBP',
          notify_on_submission: 1,
          notify_on_decision: 1,
          notify_on_comment: 0,
        }),
      );

      const req = mockRequest({ body });
      const res = mockResponse();

      await updateMyPreferences(req as Request, res as Response, next);

      // Scoped to req.user.id; the validated body is forwarded verbatim.
      expect(mockedUserModel.updatePreferences).toHaveBeenCalledWith(CALLER_ID, body);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          default_currency: 'GBP',
          notify_on_submission: true,
          notify_on_decision: true,
          notify_on_comment: false, // 0 -> false
        },
      });
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('update failed');
      mockedUserModel.updatePreferences.mockRejectedValue(dbError);

      const req = mockRequest({ body: { notify_on_decision: true } });
      const res = mockResponse();

      await updateMyPreferences(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
