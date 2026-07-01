import pool from '../../config/db';
import { statsModel } from '../../models/stats';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedPool = pool as unknown as { execute: jest.Mock; query: jest.Mock };

/** All SQL text issued during the call, from both execute() and query(). */
function allSql(): string {
  return [...mockedPool.execute.mock.calls, ...mockedPool.query.mock.calls]
    .map((c) => String(c[0]))
    .join('\n---\n');
}

/** Every bound-parameter array passed during the call. */
function allParamArrays(): unknown[][] {
  return [...mockedPool.execute.mock.calls, ...mockedPool.query.mock.calls].map((c) => c[1] ?? []);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('statsModel.getUserStats', () => {
  it('binds userId to every query, resolves {scope} to submitted_by = ?, and shapes the aggregate', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([[
        { status: 'PENDING', count: 2, total: 100 },
        { status: 'APPROVED', count: 3, total: 300 },
        { status: 'REJECTED', count: 1, total: 40 },
      ]]) // statusRows
      .mockResolvedValueOnce([[{ total: 300 }]]) // monthRows (approvedAmountMonth)
      .mockResolvedValueOnce([[{ category: 'TRAVEL', count: 1, total: 50 }]]) // catRows
      .mockResolvedValueOnce([[{ month: '2026-01', total: 100 }]]); // monthly

    const result = await statsModel.getUserStats(42);

    expect(mockedPool.execute).toHaveBeenCalledTimes(4);

    // Every query scopes to the caller only.
    for (const params of allParamArrays()) {
      expect(params).toEqual([42]);
    }

    const sql = allSql();
    // The status/category scans filter on the caller.
    expect(sql).toContain('WHERE submitted_by = ?');
    // The monthly template must be fully substituted — no literal placeholder left.
    expect(sql).not.toContain('{scope}');

    // The last execute call is the monthly query with {scope} → submitted_by = ?.
    const [monthlySql] = mockedPool.execute.mock.calls[3];
    expect(monthlySql).toContain('submitted_by = ?');
    expect(monthlySql).not.toContain('{scope}');

    expect(result).toEqual({
      totals: { submitted: 6, pending: 2, approved: 3, rejected: 1 },
      approvedAmountMonth: 300,
      baseCurrency: 'USD',
      byCategory: [{ category: 'TRAVEL', count: 1, total: 50 }],
      monthly: [{ month: '2026-01', total: 100 }],
    });
  });
});

describe('statsModel.getTeamStats', () => {
  it('binds managerId to every query and shapes the aggregate', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([[{ c: 3 }]]) // team size
      .mockResolvedValueOnce([[{ c: 2 }]]) // pending approvals
      .mockResolvedValueOnce([[{ t: 500 }]]) // team spend this month
      .mockResolvedValueOnce([[{ t: 300 }]]) // approved this month
      .mockResolvedValueOnce([[{ category: 'MEALS', count: 4, total: 120 }]]); // catRows
    mockedPool.query.mockResolvedValueOnce([[{ month: '2026-01', total: 200 }]]); // monthly

    const result = await statsModel.getTeamStats(9);

    expect(mockedPool.execute).toHaveBeenCalledTimes(5);
    expect(mockedPool.query).toHaveBeenCalledTimes(1);

    // Every query is scoped by the manager id.
    for (const params of allParamArrays()) {
      expect(params).toEqual([9]);
    }

    const sql = allSql();
    expect(sql).toContain('WHERE manager_id = ? AND is_active = 1');
    expect(sql).toContain('u.manager_id = ?');
    expect(sql).not.toContain('{scope}');

    expect(result).toEqual({
      pendingApprovals: 2,
      teamSize: 3,
      teamSpendMonth: 500,
      approvedMonth: 300,
      baseCurrency: 'USD',
      byCategory: [{ category: 'MEALS', count: 4, total: 120 }],
      monthly: [{ month: '2026-01', total: 200 }],
    });
  });
});
