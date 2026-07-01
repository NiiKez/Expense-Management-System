/**
 * Safety guard for the destructive integration-test helpers.
 *
 * The integration suite reuses the application's real connection pool
 * (`src/config/db.ts`) and its setup helpers TRUNCATE/DELETE every row in
 * `users`, `expenses`, `audit_logs`, `receipts`, `comments`, and
 * `notifications`. If the pool is ever pointed at a non-disposable database —
 * e.g. the dev default `expense_management` — those helpers would
 * irreversibly wipe live data.
 *
 * Nothing structurally prevented that before: the test process never loads
 * `.env`, so an unset `DB_NAME` falls back to `expense_management` (the dev DB)
 * in `db.ts`, and a developer who exports working `DB_*` credentials and runs
 * `npm run test:integration` would lose their data. The only thing that saved
 * them was the default `root`/blank-password login happening to be denied.
 *
 * Rule: the target database name must look disposable — it must contain "test"
 * as a bounded token (delimited by start/end or a non-letter such as `_`, `-`,
 * or a digit), AND must not carry an environment token that marks a real deploy
 * (`prod`, `production`, `live`, `staging`, `master`, `main`). CI uses
 * `expense_management_test`; the dev DB `expense_management` is correctly refused.
 *
 * A plain `/test/` substring is deliberately NOT used: it matches ordinary words
 * that merely contain the letters t-e-s-t — `latest`, `contest`, `greatest`,
 * `attestation` — any of which could be a real database that these helpers would
 * then irreversibly wipe. For a local run, point `DB_NAME` at a disposable
 * database or use the Docker test stack (docker/docker-compose.test.yml).
 */

/** The same default `db.ts` applies when DB_NAME is unset, so an unset/blank name resolves to the dev DB and is refused. */
const DEFAULT_DB_NAME = 'expense_management';

// "test" delimited by string start/end or any non-letter (e.g. `_`, `-`, digits).
// The `i` flag makes `[^a-z]` mean "not a letter" (excludes A-Z too), so this
// rejects `latest`/`contest`/`attestation` while accepting `expense_management_test`,
// `test_db`, `TEST`, and `ci_TEST_42`.
const TEST_TOKEN = /(^|[^a-z])test([^a-z]|$)/i;

// Environment markers that must NEVER be treated as disposable, even when the
// name also contains a "test" token (e.g. `prod_test_snapshot`, `live_test`).
// A destructive guard should fail closed on anything that could reference a
// real/shared environment.
const NON_DISPOSABLE_TOKEN = /(^|[^a-z])(prod|production|prd|live|staging|stage|master|main)([^a-z]|$)/i;

export function resolveTestDbName(env: NodeJS.ProcessEnv = process.env): string {
  return env.DB_NAME && env.DB_NAME.trim() !== '' ? env.DB_NAME : DEFAULT_DB_NAME;
}

export function isDisposableTestDbName(dbName: string): boolean {
  if (NON_DISPOSABLE_TOKEN.test(dbName)) {
    return false;
  }
  return TEST_TOKEN.test(dbName);
}

/**
 * Throw unless the configured database is clearly disposable. Called before any
 * destructive helper runs and once via the integration globalSetup so the whole
 * run fails fast with a clear message rather than mutating a real database.
 */
export function assertDisposableTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const dbName = resolveTestDbName(env);
  if (!isDisposableTestDbName(dbName)) {
    throw new Error(
      `Refusing to run destructive integration-test helpers against database "${dbName}". ` +
        'These helpers TRUNCATE/DELETE every row in users, expenses, and audit_logs. ' +
        'Point DB_NAME at a disposable database whose name contains "test" ' +
        '(CI uses "expense_management_test"), or run the Docker test stack ' +
        '(docker/docker-compose.test.yml).',
    );
  }
}
