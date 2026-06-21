import { test, expect, type APIRequestContext } from '@playwright/test';
import { STUB_USERS, type StubUser } from '../fixtures/users';
import { resetDatabase } from '../e2e-db';

/**
 * H2 regression guard — authorization must be enforced by the API, not only the SPA.
 *
 * The UI specs (auth.spec.ts) prove the React app hides role-gated nav links and
 * redirects unauthorized routes. That is good UX but *cosmetic* security: the SPA
 * router runs in the user's browser and is trivially bypassed (curl, Postman, a
 * forged fetch). The server is the only real trust boundary.
 *
 * These tests therefore skip the browser entirely and call the API directly via
 * Playwright's APIRequestContext, asserting the auth + RBAC middleware returns:
 *   - 401 for unauthenticated calls to protected routes,
 *   - 403 for authenticated calls from the wrong role,
 *   - 2xx for correctly-authorized calls (so the suite can't pass by blanket-denying).
 *
 * Without this, removing an `authorize([...])` guard from a route would leave the
 * whole UI-driven suite green while the API silently went wide open.
 *
 * Auth uses the dev-only, loopback-gated stub path (X-Stub-User-Id) — see
 * server/src/middleware/auth.ts. The API base URL mirrors playwright.config.ts.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

const EMPLOYEE = STUB_USERS.dave; // id 4
const MANAGER = STUB_USERS.bob; // id 2
const ADMIN = STUB_USERS.alice; // id 1

// Authenticate an API call as a seeded user via the stub-auth header.
const as = (user: StubUser) => ({ headers: { 'X-Stub-User-Id': String(user.id) } });

// Reseed once so the seven stub users exist and the allowed-case reads return
// known data, regardless of which spec ran first. These tests don't mutate, so
// per-test reseeding (the UI specs' auto fixture) isn't needed here.
test.beforeAll(async () => {
  await resetDatabase();
});

type Method = 'get' | 'patch';
interface Route {
  method: Method;
  path: string;
}

function call(request: APIRequestContext, route: Route, user?: StubUser) {
  const url = `${API}${route.path}`;
  const opts = user ? as(user) : undefined;
  return route.method === 'get' ? request.get(url, opts) : request.patch(url, opts);
}

const label = (route: Route) => `${route.method.toUpperCase()} ${route.path}`;

test.describe('API authorization — ADMIN-only routes reject non-admins', () => {
  // The org-wide ledger, member registry, stats, and audit trail. The SPA hides
  // /admin from employees and managers; the API must reject them outright.
  const routes: Route[] = [
    { method: 'get', path: '/admin/users' },
    { method: 'get', path: '/admin/expenses' },
    { method: 'get', path: '/admin/stats' },
    { method: 'get', path: '/admin/audit-logs' },
  ];

  for (const route of routes) {
    test(`${label(route)} → 401 when unauthenticated`, async ({ request }) => {
      const res = await call(request, route);
      expect(res.status()).toBe(401);
      expect((await res.json()).success).toBe(false);
    });

    test(`${label(route)} → 403 for an EMPLOYEE`, async ({ request }) => {
      const res = await call(request, route, EMPLOYEE);
      expect(res.status()).toBe(403);
      expect((await res.json()).success).toBe(false);
    });

    test(`${label(route)} → 403 for a MANAGER`, async ({ request }) => {
      const res = await call(request, route, MANAGER);
      expect(res.status()).toBe(403);
    });

    test(`${label(route)} → allowed for an ADMIN`, async ({ request }) => {
      const res = await call(request, route, ADMIN);
      expect(res.ok()).toBeTruthy();
    });
  }
});

test.describe('API authorization — approval routes require MANAGER or ADMIN', () => {
  const readRoute: Route = { method: 'get', path: '/approvals/pending' };

  test(`${label(readRoute)} → 401 when unauthenticated`, async ({ request }) => {
    const res = await call(request, readRoute);
    expect(res.status()).toBe(401);
  });

  test(`${label(readRoute)} → 403 for an EMPLOYEE`, async ({ request }) => {
    const res = await call(request, readRoute, EMPLOYEE);
    expect(res.status()).toBe(403);
    expect((await res.json()).success).toBe(false);
  });

  test(`${label(readRoute)} → allowed for a MANAGER`, async ({ request }) => {
    const res = await call(request, readRoute, MANAGER);
    expect(res.ok()).toBeTruthy();
  });

  test(`${label(readRoute)} → allowed for an ADMIN`, async ({ request }) => {
    const res = await call(request, readRoute, ADMIN);
    expect(res.ok()).toBeTruthy();
  });

  // The approve/reject mutations are the highest-impact endpoints — RBAC runs
  // before the controller, so an EMPLOYEE is rejected regardless of the target
  // expense. We assert the deny path only; the allow path has business rules
  // (self-approval, manager-relationship) covered by the manager UI spec.
  const mutations: Route[] = [
    { method: 'patch', path: '/approvals/1/approve' },
    { method: 'patch', path: '/approvals/1/reject' },
  ];

  for (const route of mutations) {
    test(`${label(route)} → 401 when unauthenticated`, async ({ request }) => {
      const res = await call(request, route);
      expect(res.status()).toBe(401);
    });

    test(`${label(route)} → 403 for an EMPLOYEE`, async ({ request }) => {
      const res = await call(request, route, EMPLOYEE);
      expect(res.status()).toBe(403);
    });
  }
});

test.describe('API authorization — manager routes are MANAGER-only (ADMIN excluded)', () => {
  // authorize([Role.MANAGER]) deliberately does NOT include ADMIN — these are
  // team-scoped views, not an admin surface. Lock that boundary in.
  const route: Route = { method: 'get', path: '/manager/stats' };

  test(`${label(route)} → 401 when unauthenticated`, async ({ request }) => {
    const res = await call(request, route);
    expect(res.status()).toBe(401);
  });

  test(`${label(route)} → 403 for an EMPLOYEE`, async ({ request }) => {
    const res = await call(request, route, EMPLOYEE);
    expect(res.status()).toBe(403);
  });

  test(`${label(route)} → 403 for an ADMIN (not a manager-scoped role)`, async ({ request }) => {
    const res = await call(request, route, ADMIN);
    expect(res.status()).toBe(403);
  });

  test(`${label(route)} → allowed for a MANAGER`, async ({ request }) => {
    const res = await call(request, route, MANAGER);
    expect(res.ok()).toBeTruthy();
  });
});

test.describe('API authorization — positive controls (not a blanket deny)', () => {
  // Prove the stub token genuinely authenticates and that the deny tests above
  // aren't passing simply because every request is rejected.
  const ownScopeRoutes: Route[] = [
    { method: 'get', path: '/me' },
    { method: 'get', path: '/expenses' },
  ];

  for (const route of ownScopeRoutes) {
    test(`${label(route)} → 401 when unauthenticated`, async ({ request }) => {
      const res = await call(request, route);
      expect(res.status()).toBe(401);
    });

    test(`${label(route)} → allowed for an EMPLOYEE`, async ({ request }) => {
      const res = await call(request, route, EMPLOYEE);
      expect(res.ok()).toBeTruthy();
    });
  }
});

test.describe('API authorization — expense data isolation (horizontal privilege)', () => {
  // GET /expenses/:id and its receipt download pass the route's authenticate gate
  // for ALL roles; the ownership/scope check lives in the controller. These tests
  // prove that check actually denies cross-user access — removing it would let any
  // authenticated user read every expense and receipt in the org.
  //
  // Seed ownership (database/seed.sql): dave(4) owns expenses 1 & 2; eve(5) owns 3 & 6;
  // frank(6) owns 4. Reporting lines: bob(2) manages dave & eve; carol(3) manages
  // frank & grace — so frank is NOT in bob's team.

  test('GET /expenses/1 → allowed for the owner (positive control)', async ({ request }) => {
    const res = await call(request, { method: 'get', path: '/expenses/1' }, EMPLOYEE); // dave owns 1
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.id).toBe(1);
  });

  test("GET /expenses/3 → 403 for an employee reading another employee's expense", async ({ request }) => {
    const res = await call(request, { method: 'get', path: '/expenses/3' }, EMPLOYEE); // eve owns 3
    expect(res.status()).toBe(403);
    expect((await res.json()).success).toBe(false);
  });

  test("GET /expenses/3/receipts/1 → 403 for an employee reading another's receipt", async ({ request }) => {
    // Access is denied before the receipt is even looked up, so the id need not exist.
    const res = await call(request, { method: 'get', path: '/expenses/3/receipts/1' }, EMPLOYEE);
    expect(res.status()).toBe(403);
  });

  test("GET /expenses/1 → allowed for the submitter's manager (positive control)", async ({ request }) => {
    const res = await call(request, { method: 'get', path: '/expenses/1' }, MANAGER); // bob manages dave
    expect(res.ok()).toBeTruthy();
  });

  test("GET /expenses/4 → 403 for a manager reading a non-report's expense", async ({ request }) => {
    const res = await call(request, { method: 'get', path: '/expenses/4' }, MANAGER); // frank reports to carol, not bob
    expect(res.status()).toBe(403);
    expect((await res.json()).success).toBe(false);
  });
});
