import { Request, Response, NextFunction } from 'express';
import { approveExpense, rejectExpense, getPendingApprovals } from '../../controllers/approvalController';
import { expenseModel } from '../../models/expense';
import { userModel } from '../../models/user';
import { GraphApiAuthError, graphApiService } from '../../services/graphApi';
import { notificationService } from '../../services/notificationService';
import { Role, Status, Category, Expense } from '../../types';

jest.mock('../../models/expense');
jest.mock('../../models/user');
jest.mock('../../services/graphApi');
jest.mock('../../services/notificationService');

const mockedExpenseModel = expenseModel as jest.Mocked<typeof expenseModel>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedGraphApiService = graphApiService as jest.Mocked<typeof graphApiService>;
const mockedNotificationService = notificationService as jest.Mocked<typeof notificationService>;

const mockExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 10,
  submitted_by: 7,
  title: 'Pending expense',
  description: null,
  amount: 100,
  currency: 'USD',
  category: Category.OTHER,
  expense_date: new Date('2026-03-01'),
  status: Status.PENDING,
  approved_by: null,
  rejection_reason: null,
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  user: {
    id: 2,
    role: Role.MANAGER,
    assignedRoles: [Role.MANAGER],
    email: 'manager@test.com',
    display_name: 'Manager',
  },
  headers: {},
  params: {},
  query: {},
  ...overrides,
});

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('approvalController.getPendingApprovals', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('returns graph-backed pending approvals for managers', async () => {
    mockedGraphApiService.getDirectReports.mockResolvedValue([
      {
        id: 'entra-employee',
        displayName: 'Employee One',
        mail: 'employee@test.com',
        userPrincipalName: 'employee@test.com',
        jobTitle: null,
        department: null,
        employeeId: null,
        officeLocation: null,
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
    mockedExpenseModel.findPendingBySubmitterIds.mockResolvedValue({
      data: [mockExpense()],
      total: 1,
    });

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
      query: { page: '1', pageSize: '20' },
    });
    const res = mockResponse();

    await getPendingApprovals(req as Request, res as Response, next);

    expect(mockedGraphApiService.getDirectReports).toHaveBeenCalledWith(2, 'token-123');
    expect(mockedUserModel.findByEntraIds).toHaveBeenCalledWith(['entra-employee']);
    expect(mockedUserModel.reassignManagerForUsers).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 7, manager_id: null })],
      2,
    );
    expect(mockedExpenseModel.findPendingBySubmitterIds).toHaveBeenCalledWith([7], { page: 1, pageSize: 20 });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expect.objectContaining({ id: 10 })],
      pagination: {
        total: 1,
        page: 1,
        pageSize: 20,
      },
      meta: {
        source: 'graph',
      },
    });
  });

  it('falls back to database-backed approvals when no bearer token is present', async () => {
    mockedExpenseModel.findPendingByManagerId.mockResolvedValue({
      data: [mockExpense()],
      total: 1,
    });

    const req = mockRequest({
      query: { page: '1', pageSize: '20' },
    });
    const res = mockResponse();

    await getPendingApprovals(req as Request, res as Response, next);

    expect(mockedGraphApiService.getDirectReports).not.toHaveBeenCalled();
    expect(mockedExpenseModel.findPendingByManagerId).toHaveBeenCalledWith(2, { page: 1, pageSize: 20 });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expect.objectContaining({ id: 10 })],
      pagination: {
        total: 1,
        page: 1,
        pageSize: 20,
      },
      meta: {
        source: 'database',
        reason: 'missing_token',
      },
    });
  });

  it('falls back to database-backed approvals when Graph lookup fails', async () => {
    mockedGraphApiService.getDirectReports.mockRejectedValue(new Error('Graph unavailable'));
    mockedExpenseModel.findPendingByManagerId.mockResolvedValue({
      data: [mockExpense()],
      total: 1,
    });

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
      query: { page: '1', pageSize: '20' },
    });
    const res = mockResponse();

    await getPendingApprovals(req as Request, res as Response, next);

    expect(mockedGraphApiService.getDirectReports).toHaveBeenCalledWith(2, 'token-123');
    expect(mockedExpenseModel.findPendingByManagerId).toHaveBeenCalledWith(2, { page: 1, pageSize: 20 });
    expect(mockedExpenseModel.findPendingBySubmitterIds).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expect.objectContaining({ id: 10 })],
      pagination: {
        total: 1,
        page: 1,
        pageSize: 20,
      },
      meta: {
        source: 'database',
        reason: 'graph_unavailable',
      },
    });
  });

  it('returns org-wide pending approvals for a real admin (unscoped)', async () => {
    mockedExpenseModel.findAll.mockResolvedValue({ data: [mockExpense()], total: 1 });

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      query: { page: '1', pageSize: '20' },
    });
    const res = mockResponse();

    await getPendingApprovals(req as Request, res as Response, next);

    expect(mockedExpenseModel.findAll).toHaveBeenCalledWith({
      status: Status.PENDING,
      page: 1,
      pageSize: 20,
      demoSessionId: undefined,
    });
  });

  it('scopes pending approvals to its own workspace for a demo admin', async () => {
    mockedExpenseModel.findAll.mockResolvedValue({ data: [mockExpense()], total: 1 });

    const req = mockRequest({
      user: {
        id: 100,
        role: Role.ADMIN,
        assignedRoles: [Role.ADMIN],
        email: 'demo.admin@demo.local',
        display_name: 'Demo Admin',
        demoMode: true,
        demoSessionId: 'sess-abc',
      },
      query: { page: '1', pageSize: '20' },
    });
    const res = mockResponse();

    await getPendingApprovals(req as Request, res as Response, next);

    // Must carry the demo workspace scope so a public demo admin never sees
    // real (or other-workspace) pending expenses.
    expect(mockedExpenseModel.findAll).toHaveBeenCalledWith({
      status: Status.PENDING,
      page: 1,
      pageSize: 20,
      demoSessionId: 'sess-abc',
    });
  });
});

describe('approvalController.approveExpense', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    // resetAllMocks (not just clearAllMocks) so any unconsumed mockResolvedValueOnce
    // queue from a prior test that short-circuited cannot leak into the next test.
    jest.resetAllMocks();
  });

  it('denies approval when Graph consent is missing instead of using cached manager assignment', async () => {
    mockedExpenseModel.findById
      .mockResolvedValueOnce(mockExpense())
      .mockResolvedValueOnce({ ...mockExpense(), status: Status.APPROVED, approved_by: 2 });
    mockedUserModel.findById.mockResolvedValue({
      id: 7,
      entra_id: 'entra-employee',
      email: 'employee@test.com',
      display_name: 'Employee One',
      role: Role.EMPLOYEE,
      manager_id: 2,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockedGraphApiService.isManagerOf.mockRejectedValue(
      new GraphApiAuthError('Consent required', 'consent_required', new Error('AADSTS65001')),
    );
    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
      params: { id: '10' },
      ip: '127.0.0.1',
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.approveWithVersion).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('approves a pending expense and notifies the submitter on the success path', async () => {
    const pending = mockExpense({ submitted_by: 7, version: 3 });
    const approved = { ...pending, status: Status.APPROVED, approved_by: 1, version: 4 };
    mockedExpenseModel.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(approved);
    mockedExpenseModel.approveWithVersion.mockResolvedValue('SUCCESS');

    // Admin bypasses the Graph manager-relationship check entirely.
    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      ip: '127.0.0.1',
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.approveWithVersion).toHaveBeenCalledWith(10, 1, 3, '127.0.0.1');
    expect(mockedNotificationService.expenseDecision).toHaveBeenCalledWith({
      expense: pending,
      actor: req.user,
      decision: 'APPROVED',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: approved });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the expense does not exist', async () => {
    mockedExpenseModel.findById.mockResolvedValue(null);

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.approveWithVersion).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('rejects approving an already-approved (non-pending) expense with a 409 conflict', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ status: Status.APPROVED }));

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.approveWithVersion).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, message: 'Only pending expenses can be approved' }),
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it('forbids approving your own expense (self-approval guard)', async () => {
    // submitted_by matches the acting admin's id.
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 1 }));

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.approveWithVersion).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, message: 'You cannot approve your own expenses' }),
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it('surfaces a 409 conflict when approveWithVersion reports VERSION_CONFLICT', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7 }));
    mockedExpenseModel.approveWithVersion.mockResolvedValue('VERSION_CONFLICT');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.approveWithVersion).toHaveBeenCalled();
    expect(mockedNotificationService.expenseDecision).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        message: 'Expense was modified by another request. Please refresh and try again.',
      }),
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it('surfaces a 409 conflict when approveWithVersion reports NOT_PENDING', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7 }));
    mockedExpenseModel.approveWithVersion.mockResolvedValue('NOT_PENDING');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedNotificationService.expenseDecision).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, message: 'Only pending expenses can be approved' }),
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it('treats an unknown / NOT_FOUND result code as a 404', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7 }));
    mockedExpenseModel.approveWithVersion.mockResolvedValue('NOT_FOUND');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedNotificationService.expenseDecision).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('approves via a manager whose Graph relationship is confirmed', async () => {
    const pending = mockExpense({ submitted_by: 7, version: 2 });
    const approved = { ...pending, status: Status.APPROVED, approved_by: 2, version: 3 };
    mockedExpenseModel.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(approved);
    mockedUserModel.findById.mockResolvedValue({
      id: 7,
      entra_id: 'entra-employee',
      email: 'employee@test.com',
      display_name: 'Employee One',
      role: Role.EMPLOYEE,
      manager_id: 2,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockedGraphApiService.isManagerOf.mockResolvedValue(true);
    mockedExpenseModel.approveWithVersion.mockResolvedValue('SUCCESS');

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
      params: { id: '10' },
      ip: '10.0.0.1',
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(mockedGraphApiService.isManagerOf).toHaveBeenCalled();
    expect(mockedExpenseModel.approveWithVersion).toHaveBeenCalledWith(10, 2, 2, '10.0.0.1');
    expect(mockedNotificationService.expenseDecision).toHaveBeenCalledWith({
      expense: pending,
      actor: req.user,
      decision: 'APPROVED',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: approved });
    expect(next).not.toHaveBeenCalled();
  });

  it('authorizes before the status check: a non-manager gets 403 (not a 409) on a decided expense', async () => {
    // Expense exists but is already APPROVED and was submitted by someone this
    // manager does NOT manage. The authorization gate must fire first, so the
    // caller cannot use a 409 to learn the expense exists and is already decided
    // (the enumeration oracle SEC fix).
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7, status: Status.APPROVED }));
    mockedUserModel.findById.mockResolvedValue({
      id: 7,
      entra_id: 'entra-employee',
      email: 'employee@test.com',
      display_name: 'Employee One',
      role: Role.EMPLOYEE,
      manager_id: 99, // not managed by user 2
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockedGraphApiService.isManagerOf.mockResolvedValue(false);

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
      params: { id: '10' },
    });
    const res = mockResponse();

    await approveExpense(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(next).not.toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    expect(mockedExpenseModel.approveWithVersion).not.toHaveBeenCalled();
  });
});

describe('approvalController.rejectExpense', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.resetAllMocks();
  });

  it('rejects a pending expense with a valid reason and notifies the submitter', async () => {
    const pending = mockExpense({ submitted_by: 7, version: 5 });
    const rejected = { ...pending, status: Status.REJECTED, rejection_reason: 'Missing receipt', version: 6 };
    mockedExpenseModel.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(rejected);
    mockedExpenseModel.rejectWithVersion.mockResolvedValue('SUCCESS');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: 'Missing receipt' },
      ip: '127.0.0.1',
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.rejectWithVersion).toHaveBeenCalledWith(10, 1, 5, 'Missing receipt', '127.0.0.1');
    expect(mockedNotificationService.expenseDecision).toHaveBeenCalledWith({
      expense: pending,
      actor: req.user,
      decision: 'REJECTED',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: rejected });
    expect(next).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from the rejection reason before persisting', async () => {
    const pending = mockExpense({ submitted_by: 7, version: 1 });
    mockedExpenseModel.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: Status.REJECTED });
    mockedExpenseModel.rejectWithVersion.mockResolvedValue('SUCCESS');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: '   Out of policy   ' },
      ip: '127.0.0.1',
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.rejectWithVersion).toHaveBeenCalledWith(10, 1, 1, 'Out of policy', '127.0.0.1');
    expect(next).not.toHaveBeenCalled();
  });

  it('passes the trimmed reason through verbatim for a whitespace-only reason', async () => {
    // The controller trusts rejectExpenseSchema (validate() middleware) to enforce a
    // non-empty reason and only calls .trim() itself. With validation bypassed in this
    // unit test, a whitespace-only reason trims to '' and is forwarded unchanged.
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7, version: 1 }));
    mockedExpenseModel.rejectWithVersion.mockResolvedValue('SUCCESS');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: '   ' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.rejectWithVersion).toHaveBeenCalledWith(10, 1, 1, '', null);
  });

  it('throws (caught by try/catch -> next) when body.reason is missing', async () => {
    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: {},
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    // Reading `.trim()` on undefined throws a TypeError, forwarded to next().
    expect(next).toHaveBeenCalledWith(expect.any(TypeError));
    expect(mockedExpenseModel.findById).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 404 when the expense does not exist', async () => {
    mockedExpenseModel.findById.mockResolvedValue(null);

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: 'Bad expense' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.rejectWithVersion).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('rejects rejecting a non-pending expense with a 409 conflict', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ status: Status.REJECTED }));

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: 'Bad expense' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.rejectWithVersion).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, message: 'Only pending expenses can be rejected' }),
    );
  });

  it('forbids rejecting your own expense (self-reject guard)', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 1 }));

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: 'Bad expense' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.rejectWithVersion).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, message: 'You cannot reject your own expenses' }),
    );
  });

  it('forbids rejection when the manager relationship cannot be verified', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7 }));
    mockedUserModel.findById.mockResolvedValue({
      id: 7,
      entra_id: 'entra-employee',
      email: 'employee@test.com',
      display_name: 'Employee One',
      role: Role.EMPLOYEE,
      manager_id: 99, // not managed by user 2
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockedGraphApiService.isManagerOf.mockResolvedValue(false);

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
      params: { id: '10' },
      body: { reason: 'Bad expense' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedExpenseModel.rejectWithVersion).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('surfaces a 409 conflict when rejectWithVersion reports VERSION_CONFLICT', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7 }));
    mockedExpenseModel.rejectWithVersion.mockResolvedValue('VERSION_CONFLICT');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: 'Bad expense' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedNotificationService.expenseDecision).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        message: 'Expense was modified by another request. Please refresh and try again.',
      }),
    );
  });

  it('surfaces a 409 conflict when rejectWithVersion reports NOT_PENDING', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7 }));
    mockedExpenseModel.rejectWithVersion.mockResolvedValue('NOT_PENDING');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: 'Bad expense' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedNotificationService.expenseDecision).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, message: 'Only pending expenses can be rejected' }),
    );
  });

  it('treats an unknown / NOT_FOUND result code as a 404', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7 }));
    mockedExpenseModel.rejectWithVersion.mockResolvedValue('NOT_FOUND');

    const req = mockRequest({
      user: { id: 1, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'admin@test.com', display_name: 'Admin' },
      params: { id: '10' },
      body: { reason: 'Bad expense' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(mockedNotificationService.expenseDecision).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('authorizes before the status check: a non-manager gets 403 (not a 409) on a decided expense', async () => {
    // Mirror of the approve guard: the auth gate precedes the status check so a
    // non-manager cannot distinguish a decided expense via a 409.
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 7, status: Status.REJECTED }));
    mockedUserModel.findById.mockResolvedValue({
      id: 7,
      entra_id: 'entra-employee',
      email: 'employee@test.com',
      display_name: 'Employee One',
      role: Role.EMPLOYEE,
      manager_id: 99, // not managed by user 2
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockedGraphApiService.isManagerOf.mockResolvedValue(false);

    const req = mockRequest({
      headers: { authorization: 'Bearer token-123' },
      params: { id: '10' },
      body: { reason: 'Bad expense' },
    });
    const res = mockResponse();

    await rejectExpense(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(next).not.toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    expect(mockedExpenseModel.rejectWithVersion).not.toHaveBeenCalled();
  });
});
