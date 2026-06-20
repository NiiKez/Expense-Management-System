import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { User, Role } from '../types';
import { cacheService } from '../services/cacheService';

interface UserRow extends RowDataPacket, User {}

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

  async findAll(): Promise<User[]> {
    const [rows] = await pool.execute<UserRow[]>(
      'SELECT * FROM users ORDER BY display_name ASC',
    );
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

  async updateManager(id: number, manager_id: number | null): Promise<User | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE users SET manager_id = ? WHERE id = ?',
      [manager_id, id],
    );

    if (result.affectedRows === 0) {
      return existing;
    }

    if (existing.manager_id !== manager_id) {
      cacheService.invalidateUser(id);
      if (existing.manager_id) {
        cacheService.invalidateUser(existing.manager_id);
      }
      if (manager_id) {
        cacheService.invalidateUser(manager_id);
      }
    }

    return this.findById(id);
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
};
