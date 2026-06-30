/**
 * Unit tests for the REAL Entra ID JWT authentication path in `authenticate`.
 *
 * Why this file exists: every other test — the Playwright e2e suite, the
 * integration suite (which mocks `authenticate` outright), and `auth.test.ts`
 * (which only exercises the dev-only STUB path) — bypasses the production
 * token-validation code. That left ZERO coverage on the controls whose failure
 * is catastrophic: JWKS signature verification, issuer & audience pinning,
 * RS256/alg pinning, the required-claim checks in `verifyToken`, and the
 * `resolveRole` "an unrecognised role is rejected with 403, never defaulted to
 * EMPLOYEE" rule. A regression in any of them would accept cross-tenant tokens
 * or silently grant access — and ship green.
 *
 * Strategy: drive the real `authenticate` against locally-minted RS256 tokens.
 * `jwks-rsa` is stubbed to hand back a public key we control, so we can sign
 * genuine tokens (and deliberately malformed ones) without touching the network
 * or a real Entra tenant. `config/entra` is mocked to deterministic issuer /
 * audience values so the tests can mint matching — and mismatching — tokens.
 */
import { Request, Response, NextFunction } from 'express';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Role, User, SecurityEventType, SecurityOutcome } from '../../types';
import { AppError } from '../../utils/errors';

// ── RSA key material ──────────────────────────────────────────
// `real*` is the key Entra would sign with — its public half is what our stubbed
// JWKS serves. `attacker*` is a key the JWKS does NOT know about, used to prove
// signature verification actually rejects forged tokens.
const realKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attackerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const realPrivatePem = realKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const attackerPrivatePem = attackerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

// jest.mock factories may only reference outer names prefixed with `mock`.
const mockPublicKeyPem = realKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

// ── Stub the JWKS client: always return our real public key ───
jest.mock('jwks-rsa', () =>
  jest.fn(() => ({
    getSigningKey: (
      _kid: string,
      cb: (err: Error | null, key?: { getPublicKey: () => string }) => void,
    ) => cb(null, { getPublicKey: () => mockPublicKeyPem }),
  })),
);

// ── Pin issuer/audience to deterministic test values ──────────
// Mirrors the real shape in config/entra.ts: v1.0 + v2.0 issuers, and both the
// api://{clientId} (v1) and bare {clientId} (v2) audiences.
jest.mock('../../config/entra', () => ({
  entraConfig: {
    tenantId: 'test-tenant-0000',
    clientId: 'test-client-1111',
    clientSecret: '',
    authority: 'https://login.microsoftonline.com/test-tenant-0000',
    jwksUri: 'https://login.microsoftonline.com/test-tenant-0000/discovery/v2.0/keys',
    issuers: [
      'https://sts.windows.net/test-tenant-0000/',
      'https://login.microsoftonline.com/test-tenant-0000/v2.0',
    ],
    audiences: ['api://test-client-1111', 'test-client-1111'],
  },
}));

// ── Mock the user model (no DB) and silence the logger ────────
jest.mock('../../models/user', () => ({
  userModel: {
    upsertByEntraId: jest.fn(),
    updateRole: jest.fn(),
    findById: jest.fn(),
  },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
// Security-event recording is verified in securityEvent.test.ts; here we only
// assert it fires (or doesn't) on the right paths, so a no-op mock is enough.
jest.mock('../../models/securityEvent', () => ({
  securityEventModel: { record: jest.fn() },
}));

// Imports that depend on the mocks above come AFTER the jest.mock calls.
import { authenticate } from '../../middleware/auth';
import { entraConfig } from '../../config/entra';
import { userModel } from '../../models/user';
import { securityEventModel } from '../../models/securityEvent';

const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedSecurityEvent = securityEventModel as jest.Mocked<typeof securityEventModel>;
const [V1_ISSUER, V2_ISSUER] = entraConfig.issuers;
const [V1_AUDIENCE, V2_AUDIENCE] = entraConfig.audiences;

// ── Helpers ───────────────────────────────────────────────────
const DEFAULT_CLAIMS: Record<string, unknown> = {
  oid: 'oid-dave-001',
  preferred_username: 'dave@contoso.com',
  name: 'Dave Employee',
  roles: ['EMPLOYEE'],
};

interface SignOpts {
  privateKey?: string;
  algorithm?: jwt.Algorithm;
  issuer?: string;
  audience?: string;
  expiresInSec?: number;
  keyid?: string | null;
}

/** Mint an RS256 (or override-algorithm) JWT. Pass `undefined` for any claim to omit it. */
function signToken(claims: Record<string, unknown> = {}, opts: SignOpts = {}): string {
  const payload: Record<string, unknown> = { ...DEFAULT_CLAIMS, ...claims };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  const {
    privateKey = realPrivatePem,
    algorithm = 'RS256',
    issuer = V2_ISSUER,
    audience = V2_AUDIENCE,
    expiresInSec = 3600,
    keyid = 'test-kid',
  } = opts;
  const signOptions: jwt.SignOptions = { algorithm, issuer, audience, expiresIn: expiresInSec };
  if (keyid !== null) signOptions.keyid = keyid;
  return jwt.sign(payload, privateKey, signOptions);
}

/** Build an unsigned `alg:none` token by hand (jsonwebtoken refuses to verify these). */
function makeAlgNoneToken(): string {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = enc({ alg: 'none', typ: 'JWT', kid: 'test-kid' });
  const body = enc({
    ...DEFAULT_CLAIMS,
    iss: V2_ISSUER,
    aud: V2_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${body}.`;
}

function dbUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    entra_id: 'oid-dave-001',
    email: 'dave@contoso.com',
    display_name: 'Dave Employee',
    role: Role.EMPLOYEE,
    manager_id: null,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeReq(token?: string, activeRole?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  // Request-scoped role switch. Passed as a string (not Role) on purpose so tests
  // can mint malformed/stale/escalation values the server must ignore.
  if (activeRole !== undefined) headers['x-active-role'] = activeRole;
  return {
    headers,
    // Non-loopback + no stub header: the stub path is inert under NODE_ENV=test.
    socket: { remoteAddress: '10.0.0.5' },
  } as unknown as Request;
}

async function run(req: Request): Promise<{ err: AppError | undefined; req: Request }> {
  const next = jest.fn() as jest.MockedFunction<NextFunction>;
  await authenticate(req, {} as Response, next);
  return { err: next.mock.calls[0]?.[0] as unknown as AppError | undefined, req };
}

// ── Suite ─────────────────────────────────────────────────────
describe('authenticate — real Entra ID JWT path', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Guarantee the stub branch stays disabled so every test hits verifyToken.
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_STUB_AUTH;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUserModel.upsertByEntraId.mockResolvedValue(dbUser());
    mockedUserModel.updateRole.mockImplementation(async (id, role) => dbUser({ id, role }));
  });

  // ── Valid tokens ────────────────────────────────────────────
  describe('valid tokens', () => {
    it('accepts a valid RS256 v2.0 token and attaches the resolved user', async () => {
      const { err, req } = await run(makeReq(signToken()));

      expect(err).toBeUndefined();
      expect(req.user).toMatchObject({ id: 42, role: Role.EMPLOYEE, email: 'dave@contoso.com' });
      expect(mockedUserModel.upsertByEntraId).toHaveBeenCalledWith({
        entra_id: 'oid-dave-001',
        email: 'dave@contoso.com',
        display_name: 'Dave Employee',
        role: Role.EMPLOYEE,
      });
    });

    it('accepts a v1.0 token (sts.windows.net issuer, api:// audience)', async () => {
      const token = signToken({}, { issuer: V1_ISSUER, audience: V1_AUDIENCE });
      const { err, req } = await run(makeReq(token));

      expect(err).toBeUndefined();
      expect(req.user?.role).toBe(Role.EMPLOYEE);
    });

    it('accepts a v1.0 token that uses the upn claim when preferred_username is absent', async () => {
      const token = signToken(
        { preferred_username: undefined, upn: 'dave@contoso.com' },
        { issuer: V1_ISSUER, audience: V1_AUDIENCE },
      );
      const { err, req } = await run(makeReq(token));

      expect(err).toBeUndefined();
      expect(req.user?.email).toBe('dave@contoso.com');
    });
  });

  // ── Signature & algorithm pinning ───────────────────────────
  describe('signature & algorithm pinning', () => {
    it('rejects a token signed by an unknown (attacker) key', async () => {
      const { err, req } = await run(makeReq(signToken({}, { privateKey: attackerPrivatePem })));

      expect(err?.statusCode).toBe(401);
      expect(req.user).toBeUndefined();
    });

    it('rejects an HS256-signed token (algorithm-confusion attempt)', async () => {
      const token = signToken({}, { algorithm: 'HS256', privateKey: 'symmetric-shared-secret' });
      const { err } = await run(makeReq(token));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects an unsigned alg:none token', async () => {
      const { err } = await run(makeReq(makeAlgNoneToken()));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects a token whose header carries no kid', async () => {
      const { err } = await run(makeReq(signToken({}, { keyid: null })));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects a token whose kid exceeds the 200-char cap', async () => {
      // The JWKS stub returns the real key regardless of kid, so the only thing
      // that can reject this token is getSigningKey's kid-length guard — which
      // makes the test fail if that DoS guard is removed.
      const { err } = await run(makeReq(signToken({}, { keyid: 'k'.repeat(201) })));

      expect(err?.statusCode).toBe(401);
    });
  });

  // ── Issuer & audience pinning ───────────────────────────────
  describe('issuer & audience pinning', () => {
    it('rejects a token from an untrusted issuer (different tenant)', async () => {
      const token = signToken({}, { issuer: 'https://sts.windows.net/evil-tenant-9999/' });
      const { err } = await run(makeReq(token));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects a token minted for the wrong audience', async () => {
      const { err } = await run(makeReq(signToken({}, { audience: 'api://some-other-client' })));

      expect(err?.statusCode).toBe(401);
    });
  });

  // ── Expiry & required claims ─────────────────────────────────
  describe('expiry & required claims', () => {
    it('rejects an expired token', async () => {
      const { err } = await run(makeReq(signToken({}, { expiresInSec: -3600 })));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects a token missing the oid claim', async () => {
      const { err } = await run(makeReq(signToken({ oid: undefined })));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects a token with no email-bearing claim (preferred_username/upn/unique_name)', async () => {
      const { err } = await run(makeReq(signToken({ preferred_username: undefined })));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects a token whose roles claim is not an array of strings', async () => {
      const { err } = await run(makeReq(signToken({ roles: 'ADMIN' })));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects a token whose oid claim is present but empty', async () => {
      // Present-but-invalid (length 0) — distinct from the missing-oid case and
      // guarded separately in verifyToken.
      const { err } = await run(makeReq(signToken({ oid: '' })));

      expect(err?.statusCode).toBe(401);
    });

    it('rejects a token whose email claim exceeds the 320-char cap', async () => {
      const oversizedEmail = `${'a'.repeat(312)}@contoso.com`; // 324 chars > 320
      const { err } = await run(makeReq(signToken({ preferred_username: oversizedEmail })));

      expect(err?.statusCode).toBe(401);
    });
  });

  // ── resolveRole: the documented "unknown role → 403" rule ───
  describe('application-role enforcement (resolveRole → 403)', () => {
    it('returns 403 when the token carries no roles claim', async () => {
      const { err } = await run(makeReq(signToken({ roles: undefined })));

      expect(err?.statusCode).toBe(403);
      expect(err?.message).toMatch(/application role/i);
    });

    it('returns 403 when the roles array is empty', async () => {
      const { err } = await run(makeReq(signToken({ roles: [] })));

      expect(err?.statusCode).toBe(403);
    });

    it('returns 403 for an unrecognised role value', async () => {
      const { err } = await run(makeReq(signToken({ roles: ['Reader'] })));

      expect(err?.statusCode).toBe(403);
    });

    it('returns 403 for a role with the wrong case ("Employee" ≠ "EMPLOYEE")', async () => {
      const { err } = await run(makeReq(signToken({ roles: ['Employee'] })));

      expect(err?.statusCode).toBe(403);
    });

    it('does NOT default an unknown role to EMPLOYEE — never touches the DB', async () => {
      const { err, req } = await run(makeReq(signToken({ roles: ['Reader'] })));

      expect(err?.statusCode).toBe(403);
      expect(req.user).toBeUndefined();
      expect(mockedUserModel.upsertByEntraId).not.toHaveBeenCalled();
    });
  });

  // ── Role precedence & DB role sync ──────────────────────────
  describe('role precedence & DB sync', () => {
    it('resolves ADMIN when several roles are assigned (highest privilege wins)', async () => {
      const { err, req } = await run(makeReq(signToken({ roles: ['EMPLOYEE', 'ADMIN'] })));

      expect(err).toBeUndefined();
      expect(req.user?.role).toBe(Role.ADMIN);
    });

    it('resolves MANAGER over EMPLOYEE (EMPLOYEE listed first, so order can\'t mask it)', async () => {
      // EMPLOYEE is listed first on purpose: a naive first-match resolver would
      // wrongly return EMPLOYEE, so this genuinely pins highest-privilege-wins.
      const { err, req } = await run(makeReq(signToken({ roles: ['EMPLOYEE', 'MANAGER'] })));

      expect(err).toBeUndefined();
      expect(req.user?.role).toBe(Role.MANAGER);
    });

    it('syncs the DB role when the token role differs from the stored role', async () => {
      // Stored as EMPLOYEE, token now says ADMIN → updateRole must run.
      const { req } = await run(makeReq(signToken({ roles: ['ADMIN'] })));

      expect(mockedUserModel.updateRole).toHaveBeenCalledWith(42, Role.ADMIN);
      expect(req.user?.role).toBe(Role.ADMIN);
    });
  });

  // ── Active-role switching via X-Active-Role ─────────────────
  // A principal holding >1 app role may "act as" any role they actually hold.
  // The switch is validated SERVER-SIDE against the JWT roles claim, so it can
  // de-escalate within held roles but can NEVER escalate beyond them.
  describe('active-role switching (X-Active-Role)', () => {
    it('exposes the full assigned-role set, ordered highest→lowest', async () => {
      const { err, req } = await run(makeReq(signToken({ roles: ['EMPLOYEE', 'ADMIN'] })));

      expect(err).toBeUndefined();
      // Ordered ADMIN, MANAGER, EMPLOYEE regardless of claim order; only held roles.
      expect(req.user?.assignedRoles).toEqual([Role.ADMIN, Role.EMPLOYEE]);
    });

    it('includes all three roles in privilege order when all are held', async () => {
      const { req } = await run(makeReq(signToken({ roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] })));

      expect(req.user?.assignedRoles).toEqual([Role.ADMIN, Role.MANAGER, Role.EMPLOYEE]);
    });

    it('defaults the active role to the highest assigned role when no header is sent', async () => {
      const { req } = await run(makeReq(signToken({ roles: ['EMPLOYEE', 'ADMIN'] })));

      expect(req.user?.role).toBe(Role.ADMIN);
    });

    it('HONORS X-Active-Role when it names a role the principal holds (de-escalation)', async () => {
      // Holds ADMIN+EMPLOYEE, asks to act as EMPLOYEE → active role is EMPLOYEE,
      // but the full assigned set is unchanged.
      const { err, req } = await run(makeReq(signToken({ roles: ['EMPLOYEE', 'ADMIN'] }), 'EMPLOYEE'));

      expect(err).toBeUndefined();
      expect(req.user?.role).toBe(Role.EMPLOYEE);
      expect(req.user?.assignedRoles).toEqual([Role.ADMIN, Role.EMPLOYEE]);
    });

    it('HONORS a switch to MANAGER for a principal holding ADMIN+MANAGER+EMPLOYEE', async () => {
      const { req } = await run(
        makeReq(signToken({ roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] }), 'MANAGER'),
      );

      expect(req.user?.role).toBe(Role.MANAGER);
    });

    it('IGNORES X-Active-Role naming a role NOT held — no escalation (key security test)', async () => {
      // Holds EMPLOYEE only, asks to act as ADMIN → must fall back to EMPLOYEE.
      const { err, req } = await run(makeReq(signToken({ roles: ['EMPLOYEE'] }), 'ADMIN'));

      expect(err).toBeUndefined(); // never 4xx on a bad header — silently ignored
      expect(req.user?.role).toBe(Role.EMPLOYEE);
      expect(req.user?.assignedRoles).toEqual([Role.EMPLOYEE]);
    });

    it('IGNORES an escalation from MANAGER to ADMIN (falls back to highest held)', async () => {
      const { req } = await run(makeReq(signToken({ roles: ['MANAGER', 'EMPLOYEE'] }), 'ADMIN'));

      expect(req.user?.role).toBe(Role.MANAGER);
    });

    it('IGNORES a malformed/unknown X-Active-Role value (falls back to highest)', async () => {
      const { req } = await run(makeReq(signToken({ roles: ['MANAGER', 'EMPLOYEE'] }), 'SuperAdmin'));

      expect(req.user?.role).toBe(Role.MANAGER);
    });

    it('IGNORES a wrong-case X-Active-Role ("employee" ≠ "EMPLOYEE")', async () => {
      // Header matching is exact/case-sensitive, mirroring role resolution.
      const { req } = await run(makeReq(signToken({ roles: ['EMPLOYEE', 'ADMIN'] }), 'employee'));

      expect(req.user?.role).toBe(Role.ADMIN);
    });

    it('syncs the DB to the CANONICAL highest role, not the switched-down active role', async () => {
      // Stored already ADMIN (canonical), token ADMIN+EMPLOYEE, switched down to
      // EMPLOYEE for this request. The active role differs from the stored role,
      // but that must NOT trigger a role sync or a ROLE_CHANGED event.
      mockedUserModel.upsertByEntraId.mockResolvedValue(dbUser({ role: Role.ADMIN }));

      const { req } = await run(makeReq(signToken({ roles: ['EMPLOYEE', 'ADMIN'] }), 'EMPLOYEE'));

      // Upsert uses the canonical highest role…
      expect(mockedUserModel.upsertByEntraId).toHaveBeenCalledWith(
        expect.objectContaining({ role: Role.ADMIN }),
      );
      // …no spurious sync, and no ROLE_CHANGED despite active !== stored.
      expect(mockedUserModel.updateRole).not.toHaveBeenCalled();
      expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
      // …while the request still acts as the switched-down role.
      expect(req.user?.role).toBe(Role.EMPLOYEE);
      expect(req.user?.assignedRoles).toEqual([Role.ADMIN, Role.EMPLOYEE]);
    });
  });

  // ── Account state & header validation ───────────────────────
  describe('account state & Authorization header', () => {
    it('rejects when the resolved user account is deactivated', async () => {
      mockedUserModel.upsertByEntraId.mockResolvedValue(dbUser({ is_active: false }));
      const { err } = await run(makeReq(signToken()));

      expect(err?.statusCode).toBe(401);
      expect(err?.message).toMatch(/deactivated/i);
    });

    it('rejects a request with no Authorization header', async () => {
      const { err } = await run(makeReq());

      expect(err?.statusCode).toBe(401);
      expect(err?.message).toMatch(/Authorization header/i);
    });

    it('rejects a non-Bearer Authorization header', async () => {
      const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' }, socket: {} } as unknown as Request;
      const { err } = await run(req);

      expect(err?.statusCode).toBe(401);
      // Pin the header guard specifically: a non-Bearer scheme must be rejected
      // up front, not slipped through to token verification.
      expect(err?.message).toMatch(/Authorization header/i);
    });

    it('rejects an oversized Authorization header (> 8192 chars)', async () => {
      const req = {
        headers: { authorization: `Bearer ${'x'.repeat(9000)}` },
        socket: {},
      } as unknown as Request;
      const { err } = await run(req);

      expect(err?.statusCode).toBe(401);
      // Assert the length cap fired (header-guard message), not the generic
      // verify catch-all — otherwise the test passes even if the cap is removed.
      expect(err?.message).toMatch(/Authorization header/i);
    });
  });

  // ── Security-event trail ────────────────────────────────────
  describe('security-event recording', () => {
    it('records AUTH_FAILURE when token verification fails', async () => {
      await run(makeReq(signToken({}, { privateKey: attackerPrivatePem })));

      expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: SecurityEventType.AUTH_FAILURE,
          outcome: SecurityOutcome.FAILURE,
        }),
      );
    });

    it('records ROLE_CHANGED only when the synced role actually differs', async () => {
      // Stored EMPLOYEE (default dbUser), token now ADMIN → a genuine change.
      await run(makeReq(signToken({ roles: ['ADMIN'] })));

      expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: SecurityEventType.ROLE_CHANGED,
          outcome: SecurityOutcome.SUCCESS,
          metadata: expect.objectContaining({ old_role: Role.EMPLOYEE, new_role: Role.ADMIN }),
        }),
      );
    });

    it('does NOT record any security event on the per-request success path', async () => {
      // Stored EMPLOYEE, token EMPLOYEE → no role change, no failure: no DB row.
      await run(makeReq(signToken()));

      expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
    });
  });
});
