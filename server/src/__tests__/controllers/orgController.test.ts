import { Request, Response, NextFunction } from 'express';
import { getOrgTree, getOrgUser } from '../../controllers/orgController';
import { userModel } from '../../models/user';
import { graphApiService } from '../../services/graphApi';
import { getBearerToken } from '../../services/managerAuthorization';
import { Role } from '../../types';
import { ORG_TREE_MAX_DEPTH } from '../../utils/constants';

// Controller-level coverage for /org/tree (ADMIN/MANAGER branch, forest-root
// derivation, maxDepth clamping, syncedAt floor, is_active coercion, demo 403)
// and /org/users/:id (scoping, MANAGER subtree RBAC, Graph enrich vs DB fallback).
// The model + Graph service are mocked; demoScope runs for real (req.user.demoMode).

jest.mock('../../models/user');
jest.mock('../../services/graphApi', () => ({
  __esModule: true,
  graphApiService: { getUserById: jest.fn(), getUserGroups: jest.fn() },
}));
jest.mock('../../services/managerAuthorization', () => ({
  __esModule: true,
  getBearerToken: jest.fn(() => 'user-access-token'),
}));

const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedGraph = graphApiService as unknown as {
  getUserById: jest.Mock;
  getUserGroups: jest.Mock;
};
const mockedGetBearerToken = getBearerToken as jest.Mock;

interface OrgUserOverrides {
  id?: number;
  role?: Role;
  demoMode?: boolean;
  demoSessionId?: string;
}

const mockRequest = (
  query: Record<string, unknown> = {},
  user: OrgUserOverrides = {},
  params: Record<string, string> = {},
): Request =>
  ({
    user: {
      id: user.id ?? 1,
      role: user.role ?? Role.ADMIN,
      assignedRoles: [user.role ?? Role.ADMIN],
      email: 'user@test.com',
      display_name: 'User',
      demoMode: user.demoMode ?? false,
      demoSessionId: user.demoSessionId,
    },
    query,
    params,
  }) as unknown as Request;

const mockResponse = (): Response => {
  const res = {} as Response;
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Minimal org-node row as the model returns it (RowDataPacket-shaped, loosely typed).
const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  display_name: 'Alice',
  role: Role.ADMIN,
  department: 'Executive',
  job_title: 'CEO',
  manager_id: null,
  is_active: 1,
  updated_at: new Date('2024-01-01T00:00:00Z'),
  ...over,
});

const resolveAll = (nodes: unknown[], truncated = false) =>
  (mockedUserModel.getAllOrgNodes as jest.Mock).mockResolvedValue({ nodes, truncated });
const resolveSubtree = (nodes: unknown[], truncated = false) =>
  (mockedUserModel.getOrgSubtree as jest.Mock).mockResolvedValue({ nodes, truncated });

const jsonBody = (res: Response) => (res.json as jest.Mock).mock.calls[0][0];

describe('orgController.getOrgTree', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('ADMIN scope', () => {
    it('reads the whole org and derives forest roots (null OR manager-not-in-set)', async () => {
      resolveAll([
        row({ id: 1, manager_id: null }),
        row({ id: 2, manager_id: 1 }),
        row({ id: 3, manager_id: 99 }), // parent 99 not in the returned set → root
      ]);
      const res = mockResponse();

      await getOrgTree(mockRequest({}, { role: Role.ADMIN }), res, next);

      expect(mockedUserModel.getAllOrgNodes).toHaveBeenCalledTimes(1);
      expect(mockedUserModel.getOrgSubtree).not.toHaveBeenCalled();
      const body = jsonBody(res);
      expect(body.success).toBe(true);
      expect(body.data.scope).toBe('ADMIN');
      expect([...body.data.rootIds].sort()).toEqual([1, 3]);
      expect(body.meta.count).toBe(3);
      expect(next).not.toHaveBeenCalled();
    });

    it('maps rows snake→camel and coerces is_active to a boolean', async () => {
      resolveAll([
        row({ id: 1, display_name: 'Ana', job_title: 'Lead', department: 'Eng', is_active: 0 }),
      ]);
      const res = mockResponse();

      await getOrgTree(mockRequest({}, { role: Role.ADMIN }), res, next);

      expect(jsonBody(res).data.nodes[0]).toEqual({
        id: 1,
        displayName: 'Ana',
        role: Role.ADMIN,
        jobTitle: 'Lead',
        department: 'Eng',
        managerId: null,
        isActive: false, // TINYINT 0 → false
      });
    });

    it('reports the OLDEST updated_at as syncedAt (freshness floor)', async () => {
      resolveAll([
        row({ id: 1, updated_at: new Date('2024-03-01T00:00:00Z') }),
        row({ id: 2, manager_id: 1, updated_at: new Date('2024-01-15T00:00:00Z') }),
        row({ id: 3, manager_id: 1, updated_at: new Date('2024-05-20T00:00:00Z') }),
      ]);
      const res = mockResponse();

      await getOrgTree(mockRequest({}, { role: Role.ADMIN }), res, next);

      expect(jsonBody(res).data.syncedAt).toBe('2024-01-15T00:00:00.000Z');
    });

    it('returns syncedAt null and count 0 for an empty org', async () => {
      resolveAll([]);
      const res = mockResponse();

      await getOrgTree(mockRequest({}, { role: Role.ADMIN }), res, next);

      const body = jsonBody(res);
      expect(body.data.syncedAt).toBeNull();
      expect(body.data.rootIds).toEqual([]);
      expect(body.meta.count).toBe(0);
    });

    it('scopes a demo admin to their workspace session id', async () => {
      resolveAll([row()]);
      const res = mockResponse();

      await getOrgTree(
        mockRequest({}, { role: Role.ADMIN, demoMode: true, demoSessionId: 'sess-1' }),
        res,
        next,
      );

      expect(mockedUserModel.getAllOrgNodes).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('MANAGER scope', () => {
    it('walks the caller subtree, roots at the caller, and defaults maxDepth', async () => {
      resolveSubtree([row({ id: 2, role: Role.MANAGER, manager_id: null })]);
      const res = mockResponse();

      await getOrgTree(mockRequest({}, { id: 2, role: Role.MANAGER }), res, next);

      expect(mockedUserModel.getOrgSubtree).toHaveBeenCalledWith(2, ORG_TREE_MAX_DEPTH, undefined);
      expect(mockedUserModel.getAllOrgNodes).not.toHaveBeenCalled();
      const body = jsonBody(res);
      expect(body.data.scope).toBe('MANAGER');
      expect(body.data.rootIds).toEqual([2]);
    });

    it.each([
      ['0', 1], // clamps below to 1
      ['-5', 1],
      ['999', ORG_TREE_MAX_DEPTH], // clamps above to the cap
      ['abc', ORG_TREE_MAX_DEPTH], // non-numeric → default
      ['3', 3], // valid passes through
    ])('clamps maxDepth=%s to %s', async (raw, expected) => {
      resolveSubtree([row({ id: 2, role: Role.MANAGER })]);
      const res = mockResponse();

      await getOrgTree(mockRequest({ maxDepth: raw }, { id: 2, role: Role.MANAGER }), res, next);

      expect(mockedUserModel.getOrgSubtree).toHaveBeenCalledWith(2, expected, undefined);
    });

    it('rejects a repeated maxDepth param with a 400 and never queries', async () => {
      const res = mockResponse();

      await getOrgTree(
        mockRequest({ maxDepth: ['1', '2'] }, { id: 2, role: Role.MANAGER }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(mockedUserModel.getOrgSubtree).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  it('forwards a 403 (never queries) when a demo session lacks a workspace id', async () => {
    const res = mockResponse();

    await getOrgTree(
      mockRequest({}, { role: Role.ADMIN, demoMode: true, demoSessionId: undefined }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockedUserModel.getAllOrgNodes).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('forwards model errors to next()', async () => {
    const dbError = new Error('db down');
    (mockedUserModel.getAllOrgNodes as jest.Mock).mockRejectedValue(dbError);
    const res = mockResponse();

    await getOrgTree(mockRequest({}, { role: Role.ADMIN }), res, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.json).not.toHaveBeenCalled();
  });
});

// A scoped OrgUserDetailRow as findOrgUser returns it (entra_id is server-only).
const detailRow = (over: Record<string, unknown> = {}) => ({
  id: 3,
  entra_id: 'entra-3',
  display_name: 'Jordan Lee',
  email: 'jordan@corp.com',
  role: Role.EMPLOYEE,
  job_title: 'Software Engineer',
  department: 'Engineering',
  employee_id: 'E-0003',
  office_location: 'San Francisco',
  manager_id: 2,
  is_active: 1,
  ...over,
});

describe('orgController.getOrgUser', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
    mockedGetBearerToken.mockReturnValue('user-access-token');
  });

  it('enriches from Graph for a real ADMIN session (source=directory)', async () => {
    mockedUserModel.findOrgUser.mockResolvedValue(detailRow() as never);
    mockedGraph.getUserById.mockResolvedValue({
      jobTitle: 'Senior Software Engineer',
      department: 'Engineering',
      mail: 'jordan.lee@corp.com',
      officeLocation: 'SF - 5th Floor',
      employeeId: 'E-0003',
      mobilePhone: '+1 555 0100',
      businessPhones: ['+1 555 0101'],
    });
    mockedGraph.getUserGroups.mockResolvedValue([{ id: 'g1', displayName: 'Engineering' }]);
    const res = mockResponse();

    await getOrgUser(mockRequest({}, { role: Role.ADMIN }, { id: '3' }), res, next);

    expect(mockedUserModel.findOrgUser).toHaveBeenCalledWith(3, undefined);
    expect(mockedGraph.getUserById).toHaveBeenCalledWith('entra-3', 'user-access-token');
    const body = jsonBody(res);
    expect(body.data.source).toBe('directory');
    expect(body.data.jobTitle).toBe('Senior Software Engineer'); // Graph overrides DB
    expect(body.data.email).toBe('jordan.lee@corp.com');
    expect(body.data.mobilePhone).toBe('+1 555 0100');
    expect(body.data.groups).toEqual([{ id: 'g1', name: 'Engineering' }]);
    expect(next).not.toHaveBeenCalled();
  });

  it('serves the DB baseline for a demo session and never calls Graph (source=local)', async () => {
    mockedUserModel.findOrgUser.mockResolvedValue(detailRow() as never);
    const res = mockResponse();

    await getOrgUser(
      mockRequest({}, { role: Role.ADMIN, demoMode: true, demoSessionId: 'sess-1' }, { id: '3' }),
      res,
      next,
    );

    expect(mockedUserModel.findOrgUser).toHaveBeenCalledWith(3, 'sess-1');
    expect(mockedGraph.getUserById).not.toHaveBeenCalled();
    const body = jsonBody(res);
    expect(body.data.source).toBe('local');
    expect(body.data.email).toBe('jordan@corp.com'); // straight from the DB row
    expect(body.data.officeLocation).toBe('San Francisco');
    expect(body.data.groups).toEqual([]);
  });

  it('falls back to the DB baseline when Graph enrichment throws', async () => {
    mockedUserModel.findOrgUser.mockResolvedValue(detailRow() as never);
    mockedGraph.getUserById.mockRejectedValue(new Error('consent_required'));
    mockedGraph.getUserGroups.mockRejectedValue(new Error('consent_required'));
    const res = mockResponse();

    await getOrgUser(mockRequest({}, { role: Role.ADMIN }, { id: '3' }), res, next);

    const body = jsonBody(res);
    expect(body.data.source).toBe('local');
    expect(body.data.email).toBe('jordan@corp.com');
    expect(next).not.toHaveBeenCalled(); // failure is swallowed, not surfaced
  });

  it('404s when the target is absent or out of scope', async () => {
    mockedUserModel.findOrgUser.mockResolvedValue(null);
    const res = mockResponse();

    await getOrgUser(mockRequest({}, { role: Role.ADMIN }, { id: '999' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('lets a MANAGER open a node inside their subtree', async () => {
    mockedUserModel.findOrgUser.mockResolvedValue(detailRow({ id: 5 }) as never);
    mockedUserModel.isInSubtree.mockResolvedValue(true);
    const res = mockResponse();

    await getOrgUser(mockRequest({}, { id: 2, role: Role.MANAGER }, { id: '5' }), res, next);

    expect(mockedUserModel.isInSubtree).toHaveBeenCalledWith(2, 5, ORG_TREE_MAX_DEPTH, undefined);
    expect(jsonBody(res).data.id).toBe(5);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s a MANAGER opening a node outside their subtree, and never calls Graph', async () => {
    mockedUserModel.findOrgUser.mockResolvedValue(detailRow({ id: 8 }) as never);
    mockedUserModel.isInSubtree.mockResolvedValue(false);
    const res = mockResponse();

    await getOrgUser(mockRequest({}, { id: 2, role: Role.MANAGER }, { id: '8' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockedGraph.getUserById).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('lets a MANAGER open their own node without a subtree check', async () => {
    mockedUserModel.findOrgUser.mockResolvedValue(detailRow({ id: 2 }) as never);
    mockedGraph.getUserById.mockResolvedValue({ businessPhones: [] });
    mockedGraph.getUserGroups.mockResolvedValue([]);
    const res = mockResponse();

    await getOrgUser(mockRequest({}, { id: 2, role: Role.MANAGER }, { id: '2' }), res, next);

    expect(mockedUserModel.isInSubtree).not.toHaveBeenCalled();
    expect(jsonBody(res).data.id).toBe(2);
  });

  it('400s on a non-numeric id before any lookup', async () => {
    const res = mockResponse();

    await getOrgUser(mockRequest({}, { role: Role.ADMIN }, { id: 'abc' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockedUserModel.findOrgUser).not.toHaveBeenCalled();
  });
});
