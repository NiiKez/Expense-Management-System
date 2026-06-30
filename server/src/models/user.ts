import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { User, Role, UserGroup } from '../types';
import { cacheService } from '../services/cacheService';
import logger from '../config/logger';
import { MAX_USER_LIST } from '../utils/constants';

// Explicit column list for list endpoints — avoids SELECT * dragging the
// in-app preference columns (default_currency, notify_*) into admin views that
// don't need them.
const USER_LIST_COLUMNS =
  'id, entra_id, email, display_name, role, manager_id, is_active, created_at, updated_at';

interface UserRow extends RowDataPacket, User {}
interface UserGroupRow extends RowDataPacket, UserGroup {}

// Microsoft Graph org attributes that sync onto the users row. A fixed allowlist
// of column names (never user-controlled) so the dynamic UPDATE is injection-safe.
const ORG_ATTRIBUTE_COLUMNS = ['department', 'job_title', 'employee_id', 'office_location'] as const;
type OrgAttributes = Partial<Record<(typeof ORG_ATTRIBUTE_COLUMNS)[number], string | null>>;

export const userModel = {
  async findById(id: number): Promise<User | null> {
    const [rows] = await pool.execute<UserRow[]>(
      'SELECT * FROM users WHERE id = ?',
      [id],
    );
    return rows[0] || null;
  },

  async findByEntraId(entraId: string): Promise<User | null> {
    const [rows] = await pool.execute<UserRow[]>(
      'SELECT * FROM users WHERE entra_id = ?',
      [entraId],
    );
    return rows[0] || null;
  },

  async findAll(demoSessionId?: string): Promise<User[]> {
    // Bounded + explicit columns. The list is returned unpaginated (the client
    // resolves names against the full set), so cap it defensively and log if the
    // cap is reached rather than silently truncating the org.
    //
    // When demoSessionId is set the caller is a demo admin, so restrict the list
    // to that one demo workspace's users — never real users or other workspaces.
    const where = demoSessionId ? 'WHERE is_demo = TRUE AND demo_session_id = ?' : '';
    const params: (string | number)[] = demoSessionId
      ? [demoSessionId, MAX_USER_LIST + 1]
      : [MAX_USER_LIST + 1];
    const [rows] = await pool.query<UserRow[]>(
      `SELECT ${USER_LIST_COLUMNS} FROM users ${where} ORDER BY display_name ASC LIMIT ?`,
      params,
    );
    if (rows.length > MAX_USER_LIST) {
      logger.warn('User list hit the MAX_USER_LIST cap; result truncated', { cap: MAX_USER_LIST });
      return rows.slice(0, MAX_USER_LIST);
    }
    return rows;
  },

  async findByManagerId(managerId: number): Promise<User[]> {
    const [rows] = await pool.execute<UserRow[]>(
      'SELECT * FROM users WHERE manager_id = ? ORDER BY display_name ASC',
      [managerId],
    );
    return rows;
  },

  async findByEntraIds(entraIds: string[]): Promise<User[]> {
    if (entraIds.length === 0) {
      return [];
    }

    const placeholders = entraIds.map(() => '?').join(', ');
    const [rows] = await pool.query<UserRow[]>(
      `SELECT * FROM users WHERE entra_id IN (${placeholders})`,
      entraIds,
    );
    return rows;
  },

  async updateRole(id: number, role: Role): Promise<User | null> {
    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE users SET role = ? WHERE id = ?',
      [role, id],
    );

    if (result.affectedRows === 0) return null;

    return this.findById(id);
  },

  // Reassign several reports to one manager in a single statement. Used by the
  // manager/approvals views to reconcile cached manager_id against Graph's live
  // direct-reports. One UPDATE plus targeted cache busts (rather than a per-row
  // fan-out with a redundant SELECT each), and no racing on a shared report
  // between two managers' concurrent reads.
  async reassignManagerForUsers(
    users: Pick<User, 'id' | 'manager_id'>[],
    managerId: number,
  ): Promise<void> {
    const toUpdate = users.filter((user) => user.manager_id !== managerId);
    if (toUpdate.length === 0) return;

    const ids = toUpdate.map((user) => user.id);
    const placeholders = ids.map(() => '?').join(', ');
    await pool.query<ResultSetHeader>(
      `UPDATE users SET manager_id = ? WHERE id IN (${placeholders})`,
      [managerId, ...ids],
    );

    // Bust the affected reports, the new manager, and every distinct previous
    // manager so stale direct-reports/manager lookups don't survive the move.
    cacheService.invalidateUser(managerId);
    for (const user of toUpdate) {
      cacheService.invalidateUser(user.id);
      if (user.manager_id) cacheService.invalidateUser(user.manager_id);
    }
  },

  async create(data: {
    entra_id: string;
    email: string;
    display_name: string;
    role?: Role;
    manager_id?: number | null;
  }): Promise<User> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (entra_id, email, display_name, role, manager_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        data.entra_id,
        data.email,
        data.display_name,
        data.role || Role.EMPLOYEE,
        data.manager_id ?? null,
      ],
    );

    const user = await this.findById(result.insertId);
    if (!user) {
      throw new Error(`Failed to load user immediately after insert (id=${result.insertId})`);
    }
    return user;
  },

  // Atomic upsert by entra_id — race-safe for concurrent first-login requests.
  // Why: two parallel requests for a brand-new user both call findByEntraId, both see
  // null, and both attempt INSERT — the second one violates uk_entra_id and throws.
  async upsertByEntraId(data: {
    entra_id: string;
    email: string;
    display_name: string;
    role: Role;
  }): Promise<User> {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO users (entra_id, email, display_name, role)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         email = VALUES(email),
         display_name = VALUES(display_name)`,
      [data.entra_id, data.email, data.display_name, data.role],
    );

    const user = await this.findByEntraId(data.entra_id);
    if (!user) {
      throw new Error(`Failed to load user after upsert (entra_id=${data.entra_id})`);
    }
    return user;
  },

  // Update the caller's own in-app preferences. Only the provided keys are
  // written (PATCH semantics); an empty patch is a no-op that still returns the
  // current row. Column names are a fixed allowlist, never user-controlled.
  async updatePreferences(
    id: number,
    prefs: Partial<{
      default_currency: string | null;
      notify_on_submission: boolean;
      notify_on_decision: boolean;
      notify_on_comment: boolean;
    }>,
  ): Promise<User | null> {
    const ALLOWED = [
      'default_currency',
      'notify_on_submission',
      'notify_on_decision',
      'notify_on_comment',
    ] as const;

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const key of ALLOWED) {
      const value = prefs[key];
      if (value === undefined) continue;
      sets.push(`${key} = ?`);
      // Normalize booleans to 0/1 for the BOOLEAN columns.
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }

    if (sets.length === 0) {
      return this.findById(id);
    }

    params.push(id);
    await pool.execute<ResultSetHeader>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    // Re-read rather than trust affectedRows: MySQL reports 0 affected rows when
    // the submitted values match what's already stored (saving an unchanged
    // form is valid, not a 404). findById returns null only if the user is gone.
    return this.findById(id);
  },

  // Persist Microsoft Graph org attributes onto a user row. PATCH semantics: only
  // the provided keys are written, an empty patch is a no-op, and the column names
  // come from a fixed allowlist (never the caller). UPDATE only — no re-read, since
  // the syncing paths already hold the values they wrote.
  async setOrgAttributes(id: number, attrs: OrgAttributes): Promise<void> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const key of ORG_ATTRIBUTE_COLUMNS) {
      const value = attrs[key];
      if (value === undefined) continue;
      sets.push(`${key} = ?`);
      params.push(value);
    }

    if (sets.length === 0) return;

    params.push(id);
    await pool.execute<ResultSetHeader>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
  },

  // Bulk-sync org attributes for several users (e.g. a manager's matched direct
  // reports). Bounded by team size, so a per-user UPDATE fanned out via Promise.all
  // is fine — no need for a single mega-statement.
  async syncOrgAttributesForUsers(
    records: {
      id: number;
      department: string | null;
      job_title: string | null;
      employee_id: string | null;
      office_location: string | null;
    }[],
  ): Promise<void> {
    if (records.length === 0) return;
    await Promise.all(
      records.map((record) =>
        this.setOrgAttributes(record.id, {
          department: record.department,
          job_title: record.job_title,
          employee_id: record.employee_id,
          office_location: record.office_location,
        }),
      ),
    );
  },

  // Atomically replace a user's entire group membership set: DELETE the old rows
  // then INSERT the new ones in one transaction, so a reader never sees a partial
  // set. Deduped by group_id defensively (the PK is (user_id, group_id), so a
  // duplicate from Graph would otherwise abort the multi-row INSERT).
  async replaceUserGroups(
    userId: number,
    groups: { group_id: string; group_name: string | null }[],
  ): Promise<void> {
    const deduped = Array.from(
      new Map(groups.map((group) => [group.group_id, group])).values(),
    );

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute<ResultSetHeader>('DELETE FROM user_groups WHERE user_id = ?', [userId]);

      if (deduped.length > 0) {
        const placeholders = deduped.map(() => '(?, ?, ?)').join(', ');
        const params: (number | string | null)[] = [];
        for (const group of deduped) {
          params.push(userId, group.group_id, group.group_name);
        }
        await conn.execute<ResultSetHeader>(
          `INSERT INTO user_groups (user_id, group_id, group_name) VALUES ${placeholders}`,
          params,
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // The user's cached Entra group memberships, alphabetized for stable display.
  async getUserGroups(userId: number): Promise<UserGroup[]> {
    const [rows] = await pool.execute<UserGroupRow[]>(
      'SELECT group_id, group_name FROM user_groups WHERE user_id = ? ORDER BY group_name ASC',
      [userId],
    );
    return rows;
  },
};
