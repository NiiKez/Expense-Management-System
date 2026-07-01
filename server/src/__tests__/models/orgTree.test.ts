import pool from '../../config/db';
import { userModel } from '../../models/user';
import { MAX_ORG_NODES } from '../../utils/constants';

// Unit coverage for the org-tree model reads: the demo scoping (in BOTH
// directions), the recursive-CTE parameter binding/order, and the defensive
// MAX_ORG_NODES cap. The pool is mocked, so these pin the generated SQL + params
// without a live DB.

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/cacheService', () => ({
  __esModule: true,
  cacheService: { invalidateUser: jest.fn(), get: jest.fn(), set: jest.fn() },
}));

import logger from '../../config/logger';

const mockedPool = pool as unknown as { execute: jest.Mock; query: jest.Mock };
const mockedLogger = logger as unknown as { warn: jest.Mock };
const SESSION = 'demo-session-abc';

beforeEach(() => {
  jest.clearAllMocks();
  mockedPool.query.mockResolvedValue([[]]);
});

describe('userModel.getAllOrgNodes', () => {
  it('excludes demo rows for a real admin and binds only the LIMIT', async () => {
    await userModel.getAllOrgNodes();

    // LIMIT with a bound `?` must go through query(), not execute().
    expect(mockedPool.execute).not.toHaveBeenCalled();
    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('WHERE is_demo = FALSE');
    expect(sql).not.toContain('is_demo = TRUE');
    expect(sql).toContain('ORDER BY display_name ASC');
    expect(sql).toContain('LIMIT ?');
    // Cap is fetched as MAX_ORG_NODES + 1 to detect overflow (mirrors findAll).
    expect(params).toEqual([MAX_ORG_NODES + 1]);
  });

  it('scopes to one workspace for a demo admin, binding the session then the cap', async () => {
    await userModel.getAllOrgNodes(SESSION);

    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('WHERE is_demo = TRUE AND demo_session_id = ?');
    expect(sql).not.toContain('is_demo = FALSE');
    expect(params).toEqual([SESSION, MAX_ORG_NODES + 1]);
  });

  it('slices to the cap, flags truncated and logs a warning when the cap is exceeded', async () => {
    const overflow = Array.from({ length: MAX_ORG_NODES + 1 }, (_, i) => ({ id: i + 1 }));
    mockedPool.query.mockResolvedValue([overflow]);

    const result = await userModel.getAllOrgNodes();

    expect(result.nodes).toHaveLength(MAX_ORG_NODES);
    expect(result.truncated).toBe(true);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('MAX_ORG_NODES'),
      { cap: MAX_ORG_NODES },
    );
  });

  it('returns rows as-is, not truncated, and does not warn under the cap', async () => {
    mockedPool.query.mockResolvedValue([[{ id: 1 }, { id: 2 }]]);

    const result = await userModel.getAllOrgNodes();

    expect(result.nodes).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });
});

describe('userModel.getOrgSubtree', () => {
  it('emits a recursive CTE walking DOWN manager_id, scoped to real users', async () => {
    await userModel.getOrgSubtree(2, 5);

    // LIMIT ? → query(), not execute().
    expect(mockedPool.execute).not.toHaveBeenCalled();
    const [sql, params] = mockedPool.query.mock.calls[0];

    expect(sql).toContain('WITH RECURSIVE subtree AS');
    expect(sql).toContain('WHERE u.id = ? AND u.is_demo = FALSE'); // anchor
    expect(sql).toContain('JOIN subtree s ON u.manager_id = s.id'); // walks down
    expect(sql).toContain('WHERE s.depth < ? AND u.is_demo = FALSE'); // recursive guard
    expect(sql).toContain('LIMIT ?');
    // Param order: rootId, maxDepth, cap+1 (over-fetch one to detect truncation;
    // no session params for a real caller).
    expect(params).toEqual([2, 5, MAX_ORG_NODES + 1]);
  });

  it('interpolates the demo scope into BOTH members and binds the session twice', async () => {
    await userModel.getOrgSubtree(2, 5, SESSION);

    const [sql, params] = mockedPool.query.mock.calls[0];
    const predicate = 'u.is_demo = TRUE AND u.demo_session_id = ?';
    // The scope clause appears in the anchor AND the recursive member.
    expect(sql.split(predicate).length - 1).toBe(2);
    expect(sql).not.toContain('u.is_demo = FALSE');
    // rootId, session (anchor), maxDepth, session (recursive), cap+1.
    expect(params).toEqual([2, SESSION, 5, SESSION, MAX_ORG_NODES + 1]);
  });

  it('flags truncated and warns when the subtree exceeds the cap', async () => {
    const overflow = Array.from({ length: MAX_ORG_NODES + 1 }, (_, i) => ({ id: i + 1 }));
    mockedPool.query.mockResolvedValue([overflow]);

    const result = await userModel.getOrgSubtree(2, 5);

    expect(result.nodes).toHaveLength(MAX_ORG_NODES);
    expect(result.truncated).toBe(true);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('MAX_ORG_NODES'),
      { cap: MAX_ORG_NODES },
    );
  });

  it('dedupes nodes surfaced more than once by a cycle in cached manager_id', async () => {
    // A→B→A cycle re-emits ids across depth levels via UNION ALL; the model must
    // return each id once and not flag truncation for a small (deduped) subtree.
    mockedPool.query.mockResolvedValue([[
      { id: 1, depth: 0 },
      { id: 2, depth: 1 },
      { id: 1, depth: 2 },
      { id: 2, depth: 3 },
    ]]);

    const result = await userModel.getOrgSubtree(1, 5);

    expect(result.nodes.map((n) => n.id)).toEqual([1, 2]);
    expect(result.truncated).toBe(false);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  it('does not flag truncated when a cycle re-emits past the cap but few are unique', async () => {
    // A cycle can make UNION ALL emit MORE raw rows than the cap while only a
    // handful of nodes are distinct. Truncation is measured AFTER dedup, so this
    // small subtree must report truncated=false (and not warn) despite the volume.
    const cyclic = Array.from({ length: MAX_ORG_NODES + 10 }, (_, i) => ({ id: (i % 3) + 1 }));
    mockedPool.query.mockResolvedValue([cyclic]);

    const result = await userModel.getOrgSubtree(1, 5);

    expect(result.nodes.map((n) => n.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });
});

describe('userModel.findOrgUser', () => {
  it('scopes a real caller to real rows and binds only the id', async () => {
    mockedPool.query.mockResolvedValue([[{ id: 3 }]]);

    await userModel.findOrgUser(3);

    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('WHERE id = ? AND is_demo = FALSE');
    expect(sql).not.toContain('is_demo = TRUE');
    expect(sql).toContain('entra_id'); // the server-only column the modal needs to call Graph
    expect(params).toEqual([3]);
  });

  it('scopes a demo caller to their workspace, binding the id then the session', async () => {
    mockedPool.query.mockResolvedValue([[{ id: 3 }]]);

    await userModel.findOrgUser(3, SESSION);

    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('WHERE id = ? AND is_demo = TRUE AND demo_session_id = ?');
    expect(params).toEqual([3, SESSION]);
  });

  it('returns null when the id is absent or out of scope', async () => {
    mockedPool.query.mockResolvedValue([[]]);
    expect(await userModel.findOrgUser(999)).toBeNull();
  });
});

describe('userModel.isInSubtree', () => {
  it('short-circuits (no query) when the target is the root itself', async () => {
    const result = await userModel.isInSubtree(2, 2, 5);
    expect(result).toBe(true);
    expect(mockedPool.query).not.toHaveBeenCalled();
  });

  it('walks the scoped subtree and returns true when the target row is found', async () => {
    mockedPool.query.mockResolvedValue([[{ id: 5 }]]);

    const result = await userModel.isInSubtree(2, 5, 5);

    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('WITH RECURSIVE subtree AS');
    expect(sql).toContain('WHERE u.id = ? AND u.is_demo = FALSE'); // anchor scope
    expect(sql).toContain('SELECT id FROM subtree WHERE id = ? LIMIT 1'); // early-out match
    // rootId, maxDepth, targetId (no session params for a real caller).
    expect(params).toEqual([2, 5, 5]);
    expect(result).toBe(true);
  });

  it('returns false when the target is not reachable from the root', async () => {
    mockedPool.query.mockResolvedValue([[]]);
    expect(await userModel.isInSubtree(2, 8, 5)).toBe(false);
  });

  it('binds the demo session into both CTE members plus the id params', async () => {
    mockedPool.query.mockResolvedValue([[{ id: 5 }]]);

    await userModel.isInSubtree(2, 5, 5, SESSION);

    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql.split('u.is_demo = TRUE AND u.demo_session_id = ?').length - 1).toBe(2);
    // rootId, session (anchor), maxDepth, session (recursive), targetId.
    expect(params).toEqual([2, SESSION, 5, SESSION, 5]);
  });
});
