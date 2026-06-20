import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { STUB_USERS, type StubUser } from './users';

interface Fixtures {
  loginAs: (user: StubUser) => Promise<void>;
  uniqueTitle: (prefix?: string) => string;
}

// 1×1 transparent PNG. Inlined so the suite has no extra fixture files to ship.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export const SAMPLE_PNG_RECEIPT = {
  name: 'receipt.png',
  mimeType: 'image/png',
  buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
};

export const test = base.extend<Fixtures>({
  loginAs: async ({ page }, use) => {
    const login = async (user: StubUser) => {
      await page.goto('/login');
      await page.getByTestId(`stub-login-${user.id}`).click();
      await page.waitForURL('/', { timeout: 15_000 });
      // Wait for the navbar to reflect the authenticated user — guards against
      // race conditions where the dashboard renders before MSAL state settles.
      await expect(page.getByTestId('nav-user-name')).toHaveText(user.displayName);
    };
    await use(login);
  },
  uniqueTitle: async ({}, use) => {
    // Each test tags its rows with a unique suffix so concurrent runs and prior
    // test residue don't interfere with assertions. We don't clean up between
    // tests; we just look up rows we own.
    const make = (prefix = 'E2E') => `${prefix} ${randomUUID().slice(0, 8)}`;
    await use(make);
  },
});

export { expect, STUB_USERS };
export type { Page, StubUser };
