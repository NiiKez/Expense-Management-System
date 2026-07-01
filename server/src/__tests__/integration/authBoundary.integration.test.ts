/**
 * Integration test — Production auth boundary + hardening headers.
 *
 * Exercises the REAL authenticate middleware (NOT mocked) so the 401 path that
 * production requests actually traverse is covered end-to-end. Also asserts the
 * app-level hardening the combined image relies on: security headers, CORS
 * origin rejection, request-id correlation, and JSON (not SPA) 404s.
 *
 * jwks-rsa is mocked to fail synchronously so a token that manages to reach the
 * signing-key fetch can never make a real network call to Entra (hermetic +
 * no hang).
 */

import pool from '../../config/db';
import { seedTestUsers, teardownTestDb } from './setup';

// Never reach out to Entra's JWKS endpoint: any getSigningKey call errors
// synchronously, so verifyToken rejects locally.
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
  },
  isGraphApiAuthError: () => false,
}));

import supertest from 'supertest';
import app from '../../app';

const request = supertest(app);

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('Auth boundary + hardening (real authenticate)', () => {
  describe('401 error contract', () => {
    it('no Authorization header → 401 with a safe, correlated error body', async () => {
      const res = await request.get('/api/v1/expenses');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.statusCode).toBe(401);
      expect(typeof res.body.error.requestId).toBe('string');
      expect(res.body.error.requestId.length).toBeGreaterThan(0);
      // Message must not leak stack traces or SQL internals.
      const message: string = res.body.error.message;
      expect(typeof message).toBe('string');
      expect(message).not.toMatch(/select|insert|update|delete\s|\bat\s.+:\d+|Error:/i);
    });

    it('garbage Bearer token → 401 and records an AUTH_FAILURE security event', async () => {
      const requestId = `authb-garbage-${Date.now()}`;
      const res = await request
        .get('/api/v1/expenses')
        .set('Authorization', 'Bearer garbage.token.here')
        .set('X-Request-Id', requestId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);

      // authenticate awaits the security-event write before responding, so the
      // row is present by the time the response resolves.
      const [rows] = await pool.execute(
        `SELECT event_type, outcome FROM security_events
          WHERE request_id = ? AND event_type = 'AUTH_FAILURE'`,
        [requestId],
      );
      expect((rows as unknown[]).length).toBe(1);
      expect((rows as Array<{ outcome: string }>)[0].outcome).toBe('FAILURE');
    });
  });

  describe('Security headers', () => {
    it('sets a CSP with connect-src \'self\' and drops x-powered-by', async () => {
      const res = await request.get('/api/v1/health');

      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain("connect-src 'self'");
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS origin enforcement', () => {
    it('rejects a disallowed Origin with 403', async () => {
      const res = await request
        .get('/api/v1/health')
        .set('Origin', 'http://evil.example');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Origin not allowed');
    });
  });

  describe('Request-id correlation', () => {
    it('echoes a supplied X-Request-Id back on the response', async () => {
      const res = await request.get('/api/v1/health').set('X-Request-Id', 'my-corr-id');
      expect(res.headers['x-request-id']).toBe('my-corr-id');
    });

    it('generates and echoes an id when none is supplied', async () => {
      const res = await request.get('/api/v1/health');
      expect(typeof res.headers['x-request-id']).toBe('string');
      expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
    });
  });

  describe('Unmatched API route', () => {
    it('GET /api/v1/does-not-exist → JSON 404 (never the SPA shell)', async () => {
      const res = await request.get('/api/v1/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.type).toBe('application/json');
      expect(res.body.success).toBe(false);
      expect(res.body.error.statusCode).toBe(404);
    });
  });
});
