import { test, expect, STUB_USERS, SAMPLE_PNG_RECEIPT } from '../fixtures/test';

test.describe('Employee — submit & manage expenses', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs(STUB_USERS.dave);
  });

  test('dashboard shows seeded expenses for Dave', async ({ page }) => {
    // Seed loads expense id=1 (Flight to NYC, PENDING) and id=2 (Team lunch, APPROVED) for Dave.
    await expect(page.getByTestId('dashboard-expense-table')).toBeVisible();
    await expect(page.getByTestId('expense-row-1')).toBeVisible();
    await expect(page.getByTestId('expense-row-2')).toBeVisible();
    await expect(page.getByTestId('expense-row-status-1')).toHaveText('PENDING');
    await expect(page.getByTestId('expense-row-status-2')).toHaveText('APPROVED');
  });

  test('submit a new expense without a receipt and see it on the dashboard', async ({ page, uniqueTitle }) => {
    const title = uniqueTitle('Submit-NoReceipt');

    await page.getByTestId('nav-file-entry').click();
    await expect(page).toHaveURL(/\/expenses\/new$/);
    await expect(page.getByTestId('expense-form')).toBeVisible();

    await page.locator('#title').fill(title);
    await page.locator('#description').fill('Coffee with a vendor');
    await page.locator('#amount').fill('42.50');
    await page.locator('#category').selectOption('MEALS');
    await page.locator('#expense_date').fill('2026-04-12');

    await page.getByTestId('expense-submit').click();

    await expect(page).toHaveURL(/\/$/);
    const titleCell = page.getByRole('link', { name: title });
    await expect(titleCell).toBeVisible();
  });

  test('submit a new expense with a PNG receipt and confirm receipt is attached', async ({ page, uniqueTitle }) => {
    const title = uniqueTitle('Submit-WithReceipt');

    await page.goto('/expenses/new');

    await page.locator('#title').fill(title);
    await page.locator('#amount').fill('99.99');
    await page.locator('#category').selectOption('SUPPLIES');
    await page.locator('#expense_date').fill('2026-04-15');

    await page.locator('#receipt-input').setInputFiles(SAMPLE_PNG_RECEIPT);
    await expect(page.locator('.file-name')).toContainText(SAMPLE_PNG_RECEIPT.name);

    await page.getByTestId('expense-submit').click();
    await expect(page).toHaveURL(/\/$/);

    const link = page.getByRole('link', { name: title });
    await expect(link).toBeVisible();
    await link.click();

    await expect(page.getByTestId('expense-detail')).toBeVisible();
    await expect(page.getByTestId('expense-detail-title')).toHaveText(title);
    await expect(page.getByTestId('expense-detail-status')).toHaveText('PENDING');
    await expect(page.locator('.receipt-name')).toContainText(SAMPLE_PNG_RECEIPT.name);
  });

  test('discard from new-expense form returns to dashboard without filing', async ({ page, uniqueTitle }) => {
    const title = uniqueTitle('Should-Not-Persist');

    await page.goto('/expenses/new');
    await page.locator('#title').fill(title);
    await page.getByTestId('expense-discard').click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  });

  test('submit form blocks invalid amount (zero) with a field error', async ({ page, uniqueTitle }) => {
    await page.goto('/expenses/new');

    await page.locator('#title').fill(uniqueTitle('InvalidAmount'));
    await page.locator('#amount').fill('0');
    await page.locator('#category').selectOption('OTHER');
    await page.locator('#expense_date').fill('2026-04-01');

    await page.getByTestId('expense-submit').click();

    // Stays on the form, surfaces a Zod field error.
    await expect(page).toHaveURL(/\/expenses\/new$/);
    await expect(page.locator('.field-error').filter({ hasText: /Amount/i })).toBeVisible();
  });

  test('expense detail page renders title, status, and back navigation', async ({ page }) => {
    await page.goto('/expenses/2'); // Seeded "Team lunch" — APPROVED — submitted by Dave (id=4)
    await expect(page.getByTestId('expense-detail')).toBeVisible();
    await expect(page.getByTestId('expense-detail-status')).toHaveText('APPROVED');

    await page.getByTestId('expense-detail-back').click();
    await expect(page).toHaveURL(/\/$/);
  });
});
