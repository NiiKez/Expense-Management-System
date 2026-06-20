import { test, expect, STUB_USERS } from '../fixtures/test';

test.describe('Authentication & RBAC', () => {
  test('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('stub-login-1')).toBeVisible();
  });

  test('stub login renders all 7 seeded users', async ({ page }) => {
    await page.goto('/login');
    for (const user of Object.values(STUB_USERS)) {
      await expect(page.getByTestId(`stub-login-${user.id}`)).toBeVisible();
    }
  });

  test('login as employee shows EMPLOYEE role and File Entry link', async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.dave);
    await expect(page.getByTestId('nav-user-role')).toHaveText('EMPLOYEE');
    await expect(page.getByTestId('nav-file-entry')).toBeVisible();
    await expect(page.getByTestId('nav-approvals')).not.toBeVisible();
    await expect(page.getByTestId('nav-registry')).not.toBeVisible();
  });

  test('login as manager shows MANAGER role and Approvals + Reports links', async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.bob);
    await expect(page.getByTestId('nav-user-role')).toHaveText('MANAGER');
    await expect(page.getByTestId('nav-approvals')).toBeVisible();
    await expect(page.getByTestId('nav-reports')).toBeVisible();
    await expect(page.getByTestId('nav-file-entry')).not.toBeVisible();
    await expect(page.getByTestId('nav-registry')).not.toBeVisible();
  });

  test('login as admin shows ADMIN role and Registry + Approvals links', async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.alice);
    await expect(page.getByTestId('nav-user-role')).toHaveText('ADMIN');
    await expect(page.getByTestId('nav-registry')).toBeVisible();
    await expect(page.getByTestId('nav-approvals')).toBeVisible();
    await expect(page.getByTestId('nav-file-entry')).not.toBeVisible();
  });

  test('sign out returns user to /login', async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.dave);
    await page.getByTestId('nav-signout').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('nav-signin')).toBeVisible();
  });

  test('employee navigating to /admin is redirected to /', async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.dave);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  test('employee navigating to /approvals is redirected to /', async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.dave);
    await page.goto('/approvals');
    await expect(page).toHaveURL(/\/$/);
  });

  test('manager navigating to /admin is redirected to /', async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.bob);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/$/);
  });

  test('admin can access /admin, /approvals, and /', async ({ page, loginAs }) => {
    await loginAs(STUB_USERS.alice);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId('admin-tab-expenses')).toBeVisible();

    await page.goto('/approvals');
    await expect(page).toHaveURL(/\/approvals$/);

    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
  });
});
