import { test, expect } from '@playwright/test';
import { resetDatabase, withConnection, countRows, SEED_EXPENSE_COUNT, SEED_USER_COUNT } from '../e2e-db';

// Regression guard for H1: isolation must not depend on a fresh DB that only CI
// provides. These tests deliberately use the base Playwright `test` (no
// auto-reset fixture) so they exercise resetDatabase() directly. They simulate
// the residue a reused local DB accumulates and prove the reset restores exactly
// the canonical seed — which is what keeps the id-based, paginated assertions in
// the UI specs deterministic.
test.describe('DB isolation — per-run reseed restores the canonical seed', () => {
  const JUNK_PREFIX = 'JUNK-RESIDUE';

  test('resetDatabase wipes accumulated residue and restores exactly the seed', async () => {
    // > the 20-row page size — the threshold past which seeded rows (id 1-6)
    // dropped off page 1 of every list and the UI assertions went flaky.
    const JUNK_ROWS = 25;

    // Arrange: simulate residue left by prior create-but-never-clean runs.
    await withConnection(async (conn) => {
      for (let i = 0; i < JUNK_ROWS; i += 1) {
        await conn.query(
          `INSERT INTO expenses (submitted_by, title, amount, category, expense_date, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [4, `${JUNK_PREFIX} ${i}`, 10.0, 'OTHER', '2026-05-01', 'PENDING'],
        );
      }
      expect(await countRows(conn, 'expenses')).toBeGreaterThan(20);
    });

    // Act
    await resetDatabase();

    // Assert: exactly the seed, residue gone, AUTO_INCREMENT reset so id=1 is the
    // first seed row again.
    await withConnection(async (conn) => {
      const [junk] = await conn.query('SELECT COUNT(*) AS n FROM expenses WHERE title LIKE ?', [
        `${JUNK_PREFIX}%`,
      ]);
      const [firstSeed] = await conn.query('SELECT title FROM expenses WHERE id = 1');

      expect(await countRows(conn, 'expenses')).toBe(SEED_EXPENSE_COUNT);
      expect(await countRows(conn, 'users')).toBe(SEED_USER_COUNT);
      expect(Number((junk as Array<{ n: number }>)[0].n)).toBe(0);
      expect((firstSeed as Array<{ title: string }>)[0]?.title).toBe('Flight to NYC');
    });
  });

  test('a clean reset leaves precisely the documented seed invariants', async () => {
    await resetDatabase();
    await withConnection(async (conn) => {
      expect(await countRows(conn, 'expenses')).toBe(SEED_EXPENSE_COUNT);
      expect(await countRows(conn, 'users')).toBe(SEED_USER_COUNT);
    });
  });
});
