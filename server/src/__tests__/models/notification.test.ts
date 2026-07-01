import pool from '../../config/db';
import { notificationModel } from '../../models/notification';
import { NotificationType } from '../../types';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedPool = pool as unknown as { execute: jest.Mock; query: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('notificationModel.markRead (ownership boundary)', () => {
  it('scopes the UPDATE to id AND user_id so a user cannot mark another user\'s notification', async () => {
    mockedPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const ok = await notificationModel.markRead(10, 3);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('UPDATE notifications SET is_read = 1');
    expect(sql).toContain('WHERE id = ? AND user_id = ?');
    // Order matters: [id, userId] — not the reverse.
    expect(params).toEqual([10, 3]);
    expect(ok).toBe(true);
  });

  it('returns false when nothing was updated (not the owner / missing row)', async () => {
    mockedPool.execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await notificationModel.markRead(10, 999)).toBe(false);
  });
});

describe('notificationModel.markAllRead', () => {
  it('updates only the caller\'s unread rows and returns the affected count', async () => {
    mockedPool.execute.mockResolvedValueOnce([{ affectedRows: 4 }]);

    const count = await notificationModel.markAllRead(3);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('UPDATE notifications SET is_read = 1');
    expect(sql).toContain('WHERE user_id = ? AND is_read = 0');
    expect(params).toEqual([3]);
    expect(count).toBe(4);
  });
});

describe('notificationModel.findByUserId', () => {
  it('counts + lists scoped to the user; no unread filter by default', async () => {
    mockedPool.execute.mockResolvedValueOnce([[{ total: 5, unread: 2 }]]); // count query
    mockedPool.query.mockResolvedValueOnce([[{ id: 1 }]]); // page query

    const result = await notificationModel.findByUserId(3);

    // Count query: execute, WHERE user_id = ?, single param.
    const [countSql, countParams] = mockedPool.execute.mock.calls[0];
    expect(countSql).toContain('SELECT COUNT(*) AS total');
    expect(countSql).toContain('COALESCE(SUM(is_read = 0), 0) AS unread');
    expect(countSql).toContain('WHERE user_id = ?');
    expect(countSql).not.toContain('AND is_read = 0');
    expect(countParams).toEqual([3]);

    // Page query: query(), ordered, paginated. Default page 1 / size 20 → limit 20 offset 0.
    const [pageSql, pageParams] = mockedPool.query.mock.calls[0];
    expect(pageSql).toContain('WHERE user_id = ?');
    expect(pageSql).toContain('ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?');
    expect(pageParams).toEqual([3, 20, 0]);

    expect(result).toEqual({ data: [{ id: 1 }], total: 5, unread: 2 });
  });

  it('appends AND is_read = 0 to BOTH the count and page queries when unreadOnly', async () => {
    mockedPool.execute.mockResolvedValueOnce([[{ total: 2, unread: 2 }]]);
    mockedPool.query.mockResolvedValueOnce([[]]);

    await notificationModel.findByUserId(3, { unreadOnly: true });

    const [countSql, countParams] = mockedPool.execute.mock.calls[0];
    expect(countSql).toContain('WHERE user_id = ? AND is_read = 0');
    expect(countParams).toEqual([3]);

    const [pageSql, pageParams] = mockedPool.query.mock.calls[0];
    expect(pageSql).toContain('WHERE user_id = ? AND is_read = 0');
    expect(pageParams).toEqual([3, 20, 0]);
  });

  it('computes OFFSET from page/pageSize', async () => {
    mockedPool.execute.mockResolvedValueOnce([[{ total: 0, unread: 0 }]]);
    mockedPool.query.mockResolvedValueOnce([[]]);

    await notificationModel.findByUserId(3, { page: 3, pageSize: 10 });

    const [, pageParams] = mockedPool.query.mock.calls[0];
    // offset = (3 - 1) * 10 = 20
    expect(pageParams).toEqual([3, 10, 20]);
  });

  it('clamps pageSize to MAX_PAGE_SIZE (100)', async () => {
    mockedPool.execute.mockResolvedValueOnce([[{ total: 0, unread: 0 }]]);
    mockedPool.query.mockResolvedValueOnce([[]]);

    await notificationModel.findByUserId(3, { pageSize: 9999 });

    const [, pageParams] = mockedPool.query.mock.calls[0];
    expect(pageParams).toEqual([3, 100, 0]);
  });
});

describe('notificationModel.countUnread', () => {
  it('counts the caller\'s unread notifications', async () => {
    mockedPool.execute.mockResolvedValueOnce([[{ unread: 7 }]]);

    const n = await notificationModel.countUnread(3);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0');
    expect(params).toEqual([3]);
    expect(n).toBe(7);
  });
});

describe('notificationModel.create', () => {
  it('inserts all five columns then re-reads the row by insertId', async () => {
    const row = { id: 55 };
    mockedPool.execute
      .mockResolvedValueOnce([{ insertId: 55 }]) // INSERT
      .mockResolvedValueOnce([[row]]); // re-read

    const result = await notificationModel.create({
      user_id: 3,
      type: NotificationType.EXPENSE_APPROVED,
      expense_id: 7,
      actor_id: 9,
      message: 'Your expense was approved',
    });

    const [insertSql, insertParams] = mockedPool.execute.mock.calls[0];
    expect(insertSql).toContain('INSERT INTO notifications (user_id, type, expense_id, actor_id, message)');
    expect(insertParams).toEqual([3, NotificationType.EXPENSE_APPROVED, 7, 9, 'Your expense was approved']);

    const [readSql, readParams] = mockedPool.execute.mock.calls[1];
    expect(readSql).toContain('SELECT * FROM notifications WHERE id = ?');
    expect(readParams).toEqual([55]);

    expect(result).toBe(row);
  });

  it('defaults optional expense_id/actor_id to null', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: 1 }]]);

    await notificationModel.create({
      user_id: 3,
      type: NotificationType.EXPENSE_COMMENT,
      message: 'hi',
    });

    const [, insertParams] = mockedPool.execute.mock.calls[0];
    expect(insertParams).toEqual([3, NotificationType.EXPENSE_COMMENT, null, null, 'hi']);
  });
});
