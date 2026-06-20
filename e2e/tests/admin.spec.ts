import { test, expect, STUB_USERS } from '../fixtures/test';

test.describe('Admin — registry & filters', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.alice);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('Ledger tab is active by default and shows the seeded expenses', async ({ page }) => {
    await expect(page.getByTestId('admin-tab-expenses')).toHaveClass(/active/);
    await expect(page.getByTestId('admin-expense-table')).toBeVisible();
    // Seed loads 6 expenses — assert presence of a known one rather than a count
    // so unrelated test residue doesn't break this assertion.
    await expect(page.getByTestId('admin-expense-row-1')).toBeVisible();
  });

  test('filter by status=APPROVED hides PENDING/REJECTED rows', async ({ page }) => {
    await page.getByTestId('admin-filter-status').selectOption('APPROVED');
    // Seed: id=1 PENDING (Flight), id=2 APPROVED, id=3 REJECTED, id=4 PENDING, id=5 APPROVED, id=6 PENDING.
    await expect(page.getByTestId('admin-expense-row-2')).toBeVisible();
    await expect(page.getByTestId('admin-expense-row-5')).toBeVisible();
    await expect(page.getByTestId('admin-expense-row-1')).toHaveCount(0);
    await expect(page.getByTestId('admin-expense-row-3')).toHaveCount(0);
    await expect(page.getByTestId('admin-expense-row-4')).toHaveCount(0);
  });

  test('filter by category=TRAVEL narrows the ledger to travel rows', async ({ page }) => {
    await page.getByTestId('admin-filter-category').selectOption('TRAVEL');
    // Seed: id=1 is the only TRAVEL row.
    await expect(page.getByTestId('admin-expense-row-1')).toBeVisible();
    await expect(page.getByTestId('admin-expense-row-2')).toHaveCount(0);
  });

  test('search by partial title narrows results, then Clear restores full list', async ({ page }) => {
    await page.getByTestId('admin-filter-search').fill('Flight');
    await expect(page.getByTestId('admin-expense-row-1')).toBeVisible();
    await expect(page.getByTestId('admin-expense-row-2')).toHaveCount(0);

    await page.getByTestId('admin-filter-clear').click();
    await expect(page.getByTestId('admin-filter-search')).toHaveValue('');
    await expect(page.getByTestId('admin-expense-row-1')).toBeVisible();
    await expect(page.getByTestId('admin-expense-row-2')).toBeVisible();
  });

  test('clicking a row navigates to the expense detail page', async ({ page }) => {
    await page.getByTestId('admin-expense-row-2').click();
    await expect(page).toHaveURL(/\/expenses\/2$/);
    await expect(page.getByTestId('expense-detail')).toBeVisible();
    await expect(page.getByTestId('expense-detail-status')).toHaveText('APPROVED');
  });

  test('switching to the Members tab activates the right section', async ({ page }) => {
    await page.getByTestId('admin-tab-users').click();
    await expect(page.getByTestId('admin-tab-users')).toHaveClass(/active/);
    await expect(page.getByTestId('admin-tab-expenses')).not.toHaveClass(/active/);
    // Don't assert on UserManagement internals — that component evolves; the tab
    // switch itself is the user-visible behaviour we're testing here.
  });
});
