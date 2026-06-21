import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { STUB_USERS, type StubUser } from './users';
import { resetDatabase } from '../e2e-db';

interface Fixtures {
  freshDatabase: void;
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
  // Auto fixture: reset the DB to the canonical seed before every test. This
  // runs during fixture setup — i.e. before each spec's beforeEach/login — so
  // every test starts from exactly the 6 seeded expenses + 7 users, regardless
  // of residue left by earlier tests or prior (possibly crashed) local runs.
  // Without it, isolation silently depended on a fresh DB that only CI provided.
  freshDatabase: [
    async ({}, use) => {
      await resetDatabase();
      await use();
    },
    { auto: true },
  ],
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
    // Each test tags its rows with a unique suffix so its own within-test rows
    // are unambiguous to look up. The DB is reset to seed before every test (see
    // the `freshDatabase` fixture), so residue isn't a concern; the unique tag
    // mainly keeps a test's assertions independent of any row it just created.
    const make = (prefix = 'E2E') => `${prefix} ${randomUUID().slice(0, 8)}`;
    await use(make);
  },
});

export { expect, STUB_USERS };
export type { Page, StubUser };
