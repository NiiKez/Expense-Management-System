/**
 * Integration test — Public demo-login route (real route, real auth).
 *
 * The demo-login handler is otherwise only covered by a fully-mocked unit test.
 * Here the route, config/demo, and demoService all run for real against MySQL:
 *   - a minted demo token actually authenticates a follow-up /me request,
 *   - the mint is recorded as a DEMO_SESSION_ISSUED security event,
 *   - the disabled path (ENABLE_DEMO off) 403s,
 *   - an unrecognized requested role falls back to MANAGER by design.
 */

import pool from '../../config/db';
import { teardownTestDb } from './setup';

// Hermetic: never contact Entra's JWKS (defensive — the demo token path never
// reaches real Entra verification, but a stray token must not hang on network).
jest.mock('jwks-rsa', () =>
  jest.fn(() => ({
    getSigningKey: (_kid: string, cb: (err: Error) => void) =>
      cb(new Error('jwks disabled in tests')),
  })),
);

jest.mock('../../services/graphApi', () => ({
  graphApiService: {
    isManagerOf: jest.fn().mockResolvedValue(true),
    getManager: jest.fn().mockResolvedValue(null),
    getDirectReports: jest.fn().mockResolvedValue([]),
    getMyOrgProfile: jest.fn(),
    getManagerChain: jest.fn(),
    getGroupMemberships: jest.fn(),
  },
  isGraphApiAuthError: () => false,
}));

import supertest from 'supertest';
import app from '../../app';

const request = supertest(app);

// The demo path is gated on these env vars, read at request time in
// routes/auth.ts. Set them here so the suite is self-contained and passes under
// any runner — the CI docker-compose test-runner does not export them. The
// disabled-path test below toggles ENABLE_DEMO around its own assertion.
process.env.ENABLE_DEMO = 'true';
process.env.DEMO_JWT_SECRET = process.env.DEMO_JWT_SECRET ?? 'integration-demo-secret';

afterAll(async () => {
  await teardownTestDb();
});

describe('Public demo-login route', () => {
  it('mints an ADMIN demo token that authenticates /me and logs DEMO_SESSION_ISSUED', async () => {
    const requestId = `demologin-admin-${Date.now()}`;
    const loginRes = await request
      .post('/api/v1/auth/demo-login')
      .set('X-Request-Id', requestId)
      .send({ role: 'ADMIN' });

    expect(loginRes.status).toBe(201);
    const token = loginRes.body.data.token as string;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);

    // The minted token authenticates a real request through the full auth stack.
    const meRes = await request.get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.role).toBe('ADMIN');

    // The mint was recorded as a durable security event.
    const [rows] = await pool.execute(
      `SELECT event_type, outcome FROM security_events
        WHERE request_id = ? AND event_type = 'DEMO_SESSION_ISSUED'`,
      [requestId],
    );
    expect((rows as unknown[]).length).toBe(1);
    expect((rows as Array<{ outcome: string }>)[0].outcome).toBe('SUCCESS');
  });

  it('an unrecognized requested role falls back to MANAGER', async () => {
    const loginRes = await request
      .post('/api/v1/auth/demo-login')
      .send({ role: 'SUPERADMIN' });

    expect(loginRes.status).toBe(201);
    const token = loginRes.body.data.token as string;

    const meRes = await request.get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.role).toBe('MANAGER');
  });

  it('returns 403 when demo mode is disabled', async () => {
    // isDemoEnabled() reads process.env at call time, so toggling it here flips
    // the route's behavior without a re-import.
    const previous = process.env.ENABLE_DEMO;
    process.env.ENABLE_DEMO = 'false';
    try {
      const res = await request.post('/api/v1/auth/demo-login').send({ role: 'ADMIN' });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    } finally {
      process.env.ENABLE_DEMO = previous;
    }
  });
});
