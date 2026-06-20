import { test, expect, STUB_USERS } from '../fixtures/test';

// Helper: file a fresh PENDING expense as a given employee. Returns the title
// (uniquely tagged) so the manager test can find it on the approvals page.
// We don't reuse seed.sql expenses because approve/reject mutates them.
async function fileExpenseAs(
  page: import('@playwright/test').Page,
  loginAs: (user: typeof STUB_USERS[keyof typeof STUB_USERS]) => Promise<void>,
  user: typeof STUB_USERS[keyof typeof STUB_USERS],
  title: string,
) {
  await loginAs(user);
  await page.goto('/expenses/new');
  await page.locator('#title').fill(title);
  await page.locator('#amount').fill('250.00');
  await page.locator('#category').selectOption('TRAVEL');
  await page.locator('#expense_date').fill('2026-04-20');
  await page.getByTestId('expense-submit').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  // Sign out so the next loginAs starts cleanly.
  await page.getByTestId('nav-signout').click();
  await expect(page).toHaveURL(/\/login$/);
}

async function findApprovalCard(page: import('@playwright/test').Page, title: string) {
  // Match the approval card whose title matches.
  const card = page
    .locator('article.approval-card')
    .filter({ has: page.locator('.approval-card-title', { hasText: title }) })
    .first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  return card;
}

test.describe('Manager — pending approvals workflow', () => {
  test('Bob sees pending expenses from his direct reports', async ({ page, loginAs, uniqueTitle }) => {
    const title = uniqueTitle('Mgr-Sees-Pending');
    // Dave (id=4) reports to Bob (id=2) per seed.sql.
    await fileExpenseAs(page, loginAs, STUB_USERS.dave, title);

    await loginAs(STUB_USERS.bob);
    await page.getByTestId('nav-approvals').click();
    await expect(page).toHaveURL(/\/approvals$/);

    await findApprovalCard(page, title);
  });

  test('Bob can approve a pending expense and it disappears from the list', async ({ page, loginAs, uniqueTitle }) => {
    const title = uniqueTitle('Mgr-Approves');
    await fileExpenseAs(page, loginAs, STUB_USERS.dave, title);

    await loginAs(STUB_USERS.bob);
    await page.goto('/approvals');

    const card = await findApprovalCard(page, title);
    const expenseId = await card.getAttribute('data-testid');
    expect(expenseId).toMatch(/^approval-card-\d+$/);
    const id = expenseId!.replace('approval-card-', '');

    await page.getByTestId(`approval-approve-${id}`).click();

    await expect(page.getByTestId(`approval-card-${id}`)).toHaveCount(0);
    await expect(page.locator('.approval-card-title', { hasText: title })).toHaveCount(0);
  });

  test('rejecting without a reason surfaces a validation error', async ({ page, loginAs, uniqueTitle }) => {
    const title = uniqueTitle('Mgr-RejectEmpty');
    await fileExpenseAs(page, loginAs, STUB_USERS.dave, title);

    await loginAs(STUB_USERS.bob);
    await page.goto('/approvals');

    const card = await findApprovalCard(page, title);
    const id = (await card.getAttribute('data-testid'))!.replace('approval-card-', '');

    await page.getByTestId(`approval-reject-${id}`).click();
    // Reason textarea is empty — confirm rejection should surface a client error.
    await page.getByTestId(`approval-confirm-reject-${id}`).click();

    await expect(page.getByTestId(`approval-error-${id}`)).toContainText(/reason is required/i);
    // Card stays on screen — the reject didn't go through.
    await expect(page.getByTestId(`approval-card-${id}`)).toBeVisible();
  });

  test('Bob can reject a pending expense with a written reason', async ({ page, loginAs, uniqueTitle }) => {
    const title = uniqueTitle('Mgr-Rejects');
    await fileExpenseAs(page, loginAs, STUB_USERS.dave, title);

    await loginAs(STUB_USERS.bob);
    await page.goto('/approvals');

    const card = await findApprovalCard(page, title);
    const id = (await card.getAttribute('data-testid'))!.replace('approval-card-', '');

    await page.getByTestId(`approval-reject-${id}`).click();
    await page
      .getByTestId(`approval-reject-reason-${id}`)
      .fill('Out of policy: travel pre-approval missing.');
    await page.getByTestId(`approval-confirm-reject-${id}`).click();

    await expect(page.getByTestId(`approval-card-${id}`)).toHaveCount(0);
  });
});
