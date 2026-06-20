import { test, expect, STUB_USERS } from '../fixtures/test';

// Helper: file a PENDING expense as a given user and return its URL path.
async function fileExpense(
  page: import('@playwright/test').Page,
  loginAs: (user: typeof STUB_USERS[keyof typeof STUB_USERS]) => Promise<void>,
  user: typeof STUB_USERS[keyof typeof STUB_USERS],
  title: string,
): Promise<string> {
  await loginAs(user);
  await page.goto('/expenses/new');
  await page.locator('#title').fill(title);
  await page.locator('#amount').fill('75.00');
  await page.locator('#category').selectOption('MEALS');
  await page.locator('#expense_date').fill('2026-05-01');
  await page.getByTestId('expense-submit').click();
  await expect(page).toHaveURL(/\/$/);
  // Click the title link so we get the detail URL.
  const link = page.getByRole('link', { name: title });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByTestId('expense-detail')).toBeVisible();
  const detailUrl = page.url();
  return detailUrl;
}

test.describe('Detail page — owner actions', () => {
  test('Owner can edit a pending expense from the detail page', async ({
    page,
    loginAs,
    uniqueTitle,
  }) => {
    const title = uniqueTitle('Detail-Edit');
    const newTitle = uniqueTitle('Detail-Edited');

    // File expense and land on detail page.
    await fileExpense(page, loginAs, STUB_USERS.dave, title);

    // Click the Edit button.
    await page.getByTestId('detail-edit').click();
    await expect(page).toHaveURL(/\/expenses\/\d+\/edit$/);

    // Update the title on the edit form.
    await page.locator('#title').fill(newTitle);
    await page.getByTestId('expense-submit').click();

    // Should navigate back to the detail page and show the new title.
    await expect(page).toHaveURL(/\/expenses\/\d+$/);
    await expect(page.getByTestId('expense-detail-title')).toHaveText(newTitle);
  });

  test('Owner can delete a pending expense from the detail page', async ({
    page,
    loginAs,
    uniqueTitle,
  }) => {
    const title = uniqueTitle('Detail-Delete');

    // File expense and land on detail page.
    await fileExpense(page, loginAs, STUB_USERS.dave, title);

    // Open the delete dialog and confirm.
    await page.getByTestId('detail-delete').click();
    await expect(page.getByTestId('detail-confirm-delete')).toBeVisible();
    await page.getByTestId('detail-confirm-delete').click();

    // Should navigate back to the dashboard.
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Detail page — admin approval actions', () => {
  test('Admin can approve a pending expense from the detail page', async ({
    page,
    loginAs,
    uniqueTitle,
  }) => {
    const title = uniqueTitle('Detail-Approve');

    // File the expense as Dave.
    const detailUrl = await fileExpense(page, loginAs, STUB_USERS.dave, title);

    // Sign out Dave.
    await page.getByTestId('nav-signout').click();
    await expect(page).toHaveURL(/\/login$/);

    // Log in as Alice (ADMIN).
    await loginAs(STUB_USERS.alice);

    // Navigate directly to the expense detail page.
    await page.goto(detailUrl);
    await expect(page.getByTestId('expense-detail')).toBeVisible();
    await expect(page.getByTestId('expense-detail-status')).toHaveText('PENDING');

    // Approve the expense.
    await page.getByTestId('detail-approve').click();

    // Status should update to APPROVED in-place (refetch happens after approval).
    await expect(page.getByTestId('expense-detail-status')).toHaveText('APPROVED', {
      timeout: 10_000,
    });
  });
});
