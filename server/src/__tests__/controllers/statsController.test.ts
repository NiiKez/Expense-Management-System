import { Request, Response, NextFunction } from 'express';
import { getMyStats, getManagerStats, getAdminStats } from '../../controllers/statsController';
import { statsModel } from '../../models/stats';
import { Role } from '../../types';

jest.mock('../../models/stats');
const mockedStatsModel = statsModel as jest.Mocked<typeof statsModel>;

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  user: { id: 4, role: Role.EMPLOYEE, email: 'dave@test.com', display_name: 'Dave' },
  headers: {}, query: {}, ...overrides,
});
const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('statsController.getMyStats', () => {
  let next: jest.MockedFunction<NextFunction>;
  beforeEach(() => { next = jest.fn(); jest.clearAllMocks(); });

  it('returns the caller stats in the standard envelope', async () => {
    const data = { totals: { submitted: 2, pending: 1, approved: 1, rejected: 0 }, approvedAmountMonth: 125.5, baseCurrency: 'USD', byCategory: [], monthly: [] };
    mockedStatsModel.getUserStats.mockResolvedValue(data);
    const req = mockRequest(); const res = mockResponse();
    await getMyStats(req as Request, res as Response, next);
    expect(mockedStatsModel.getUserStats).toHaveBeenCalledWith(4);
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards model errors to next and does not write a response', async () => {
    const err = new Error('user stats query failed');
    mockedStatsModel.getUserStats.mockRejectedValue(err);
    const req = mockRequest(); const res = mockResponse();
    await getMyStats(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('statsController.getManagerStats', () => {
  let next: jest.MockedFunction<NextFunction>;
  beforeEach(() => { next = jest.fn(); jest.clearAllMocks(); });

  it('returns the caller team stats in the standard envelope', async () => {
    const data = {
      pendingApprovals: 3, teamSize: 5, teamSpendMonth: 980.25, approvedMonth: 640.5,
      baseCurrency: 'USD', byCategory: [], monthly: [],
    };
    mockedStatsModel.getTeamStats.mockResolvedValue(data);
    const req = mockRequest({ user: { id: 2, role: Role.MANAGER, email: 'manager@test.com', display_name: 'Manager' } });
    const res = mockResponse();
    await getManagerStats(req as Request, res as Response, next);
    expect(mockedStatsModel.getTeamStats).toHaveBeenCalledWith(2);
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards model errors to next and does not write a response', async () => {
    const err = new Error('team stats query failed');
    mockedStatsModel.getTeamStats.mockRejectedValue(err);
    const req = mockRequest({ user: { id: 2, role: Role.MANAGER, email: 'manager@test.com', display_name: 'Manager' } });
    const res = mockResponse();
    await getManagerStats(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('statsController.getAdminStats', () => {
  let next: jest.MockedFunction<NextFunction>;
  beforeEach(() => { next = jest.fn(); jest.clearAllMocks(); });

  it('returns org-wide stats in the standard envelope', async () => {
    const data = {
      orgSpendMonth: 12000.75, pendingOrgWide: 9, activeUsers: 42, approvedMonth: 8400.5,
      baseCurrency: 'USD', byCategory: [], monthly: [],
    };
    mockedStatsModel.getOrgStats.mockResolvedValue(data);
    const req = mockRequest({ user: { id: 3, role: Role.ADMIN, email: 'admin@test.com', display_name: 'Admin' } });
    const res = mockResponse();
    await getAdminStats(req as Request, res as Response, next);
    expect(mockedStatsModel.getOrgStats).toHaveBeenCalledWith();
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards model errors to next and does not write a response', async () => {
    const err = new Error('org stats query failed');
    mockedStatsModel.getOrgStats.mockRejectedValue(err);
    const req = mockRequest({ user: { id: 3, role: Role.ADMIN, email: 'admin@test.com', display_name: 'Admin' } });
    const res = mockResponse();
    await getAdminStats(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });
});
