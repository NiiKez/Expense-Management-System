import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Hardcoded local-only DB credentials — see docker/docker-compose.e2e.yml.
// Nothing here is sensitive; the DB is bound to loopback and tmpfs-backed.
// Env overrides exist so the same reset can target a non-default DB if needed.
export const E2E_DB = {
  DB_HOST: process.env.E2E_DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.E2E_DB_PORT ?? '3307',
  DB_USER: process.env.E2E_DB_USER ?? 'expense_app',
  DB_PASSWORD: process.env.E2E_DB_PASSWORD ?? 'e2e-app-password',
  DB_NAME: process.env.E2E_DB_NAME ?? 'expense_management_e2e',
} as const;

// Canonical seed invariants (database/seed.sql). Tests and the reset verifier
// assert against these so a partial/failed reseed aborts loudly.
export const SEED_USER_COUNT = 7;
export const SEED_EXPENSE_COUNT = 6;
export const SEED_AUDIT_LOG_COUNT = 9;

// Single source of truth for the seed lives in database/seed.sql; we re-run it
// rather than duplicating fixture rows here.
const SEED_PATH = path.resolve(__dirname, '../database/seed.sql');

// The seed file is immutable for a run, but resetDatabase() runs before every
// test (via the freshDatabase fixture). Read it once per process and reuse so a
// serial suite doesn't re-read the same file on every test.
let seedSqlCache: string | undefined;
async function loadSeedSql(): Promise<string> {
  if (seedSqlCache === undefined) {
    seedSqlCache = await readFile(SEED_PATH, 'utf8');
  }
  return seedSqlCache;
}

// Child-before-parent ordering is cosmetic — FK checks are disabled while we
// truncate so order doesn't matter — but it documents the dependency graph.
const TABLES_TO_RESET = [
  'notifications',
  'comments',
  'receipts',
  'audit_logs',
  'expenses',
  'users',
] as const;

function connect(): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: E2E_DB.DB_HOST,
    port: Number(E2E_DB.DB_PORT),
    user: E2E_DB.DB_USER,
    password: E2E_DB.DB_PASSWORD,
    database: E2E_DB.DB_NAME,
    // seed.sql is a multi-statement script (START TRANSACTION … COMMIT).
    multipleStatements: true,
  });
}

/** Open a connection, run `fn`, and always close it. */
export async function withConnection<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await connect();
  try {
    return await fn(conn);
  } finally {
    // Swallow close errors so a failure inside `fn` (the real error) isn't
    // masked by a rejecting end() when the connection already died mid-query.
    try {
      await conn.end();
    } catch {
      /* ignore close errors */
    }
  }
}

export async function countRows(conn: mysql.Connection, table: string): Promise<number> {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return Number((rows as Array<{ n: number }>)[0].n);
}

/**
 * Reset the E2E database to the canonical seed state.
 *
 * Why this exists: isolation used to depend on a fresh DB, which only CI
 * guaranteed (tmpfs + `down -v`). Locally the DB is reused across runs and the
 * specs create-but-never-clean expenses, so residue accumulated. Because every
 * list paginates at 20 rows ordered `created_at DESC`, accumulated rows pushed
 * the seeded rows (id 1-6) off page 1 and the id-based assertions went flaky.
 * Reseeding before each test makes the known seed a property of the run, not of
 * the environment, and keeps each test well under the page size.
 *
 * Fail-closed: if the reseed doesn't restore the exact seed counts we throw, so
 * the suite aborts instead of running against an unknown DB state.
 */
export async function resetDatabase(): Promise<void> {
  const seedSql = await loadSeedSql();

  await withConnection(async (conn) => {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES_TO_RESET) {
      // TRUNCATE (not DELETE) so AUTO_INCREMENT resets to 1 — created rows then
      // start at id 7, exactly as on a fresh DB. It also bypasses the
      // append-only DELETE trigger on audit_logs, which DELETE would trip.
      await conn.query(`TRUNCATE TABLE \`${table}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    await conn.query(seedSql);

    const users = await countRows(conn, 'users');
    const expenses = await countRows(conn, 'expenses');
    // Also verify a child table (audit_logs) so that dropping a table from
    // TABLES_TO_RESET — which would leave the seed's `WHERE NOT EXISTS` guard to
    // silently skip its rows — is caught here instead of running half-stale.
    const auditLogs = await countRows(conn, 'audit_logs');
    if (
      users !== SEED_USER_COUNT ||
      expenses !== SEED_EXPENSE_COUNT ||
      auditLogs !== SEED_AUDIT_LOG_COUNT
    ) {
      throw new Error(
        `E2E DB reset verification failed: expected ${SEED_USER_COUNT} users, ` +
          `${SEED_EXPENSE_COUNT} expenses, and ${SEED_AUDIT_LOG_COUNT} audit logs after reseed, ` +
          `got ${users} users, ${expenses} expenses, and ${auditLogs} audit logs. ` +
          'Is database/seed.sql in sync with this reset?',
      );
    }
  });
}
