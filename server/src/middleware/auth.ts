import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { Role, SecurityEventType, SecurityOutcome } from '../types';
import { entraConfig } from '../config/entra';
import { forbidden, unauthorized } from '../utils/errors';
import logger from '../config/logger';
import { userModel } from '../models/user';
import { securityEventModel } from '../models/securityEvent';
import { getDemoSecret, isDemoEnabled } from '../config/demo';

// JWKS client — caches signing keys from Entra ID.
// Why higher limits: Entra rotates keys periodically; cache + a generous request
// budget prevents self-DoS during a key roll-over with mixed-kid traffic.
const jwksClient = jwksRsa({
  jwksUri: entraConfig.jwksUri,
  cache: true,
  cacheMaxEntries: 10,
  cacheMaxAge: 24 * 60 * 60 * 1000, // 24h
  rateLimit: true,
  jwksRequestsPerMinute: 30,
});

// Callback used by jsonwebtoken to fetch the signing key
function getSigningKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  if (header.alg !== 'RS256') {
    callback(new Error('Unsupported JWT signing algorithm'));
    return;
  }

  if (!header.kid) {
    callback(new Error('JWT header missing kid'));
    return;
  }
  if (header.kid.length > 200) {
    callback(new Error('JWT header kid is too long'));
    return;
  }
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    callback(null, key?.getPublicKey());
  });
}

interface EntraIdTokenPayload extends jwt.JwtPayload {
  oid: string;            // Entra Object ID
  preferred_username?: string; // email / UPN (v2.0 tokens)
  upn?: string;           // User Principal Name (v1.0 tokens)
  unique_name?: string;   // fallback display name (v1.0 tokens)
  name?: string;          // display name
  roles?: unknown;        // App roles assigned in Entra ID
}

/**
 * Resolve the FULL set of recognized app roles from the Entra ID `roles` claim,
 * ordered highest→lowest privilege: ADMIN, then MANAGER, then EMPLOYEE. Only roles
 * actually present are included; unrecognized values are dropped. Returns `[]` when
 * the claim carries no recognized role (caller rejects with 403).
 */
function resolveRoles(roles?: unknown): Role[] {
  if (!Array.isArray(roles) || roles.length === 0) return [];
  const resolved: Role[] = [];
  if (roles.includes(Role.ADMIN)) resolved.push(Role.ADMIN);
  if (roles.includes(Role.MANAGER)) resolved.push(Role.MANAGER);
  if (roles.includes(Role.EMPLOYEE)) resolved.push(Role.EMPLOYEE);
  return resolved;
}

/**
 * Pick the request-scoped ACTIVE role from the X-Active-Role header. Honored ONLY
 * when it names a role the principal actually holds; any other value (stale,
 * malformed, or an escalation attempt) is SILENTLY ignored, falling back to the
 * highest assigned role. This is what guarantees a switch can never escalate
 * beyond the roles Entra assigned.
 */
function resolveActiveRole(assignedRoles: Role[], header: unknown): Role {
  // assignedRoles is ordered highest-first; [0] is the canonical default.
  const requested = typeof header === 'string' ? header : undefined;
  if (requested && (assignedRoles as string[]).includes(requested)) {
    return requested as Role;
  }
  return assignedRoles[0];
}

/**
 * Stub auth for local development only.
 * Why: lets the frontend run against the API without an Entra ID app registration.
 * Hardened: requires NODE_ENV=development, ALLOW_STUB_AUTH=true, and a loopback
 * request. A VITE_* browser "secret" is not a secret, so locality is the useful
 * control here. server.ts also blocks ALLOW_STUB_AUTH outside development.
 */
let stubAuthLoggedOnce = false;

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;

  const normalized = value.toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
    || normalized.startsWith('127.');
}

function isLocalUrl(value: string | undefined): boolean {
  if (!value) return true;

  try {
    const parsed = new URL(value);
    return parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

function isLocalHostHeader(value: string | string[] | undefined): boolean {
  if (!value || Array.isArray(value)) return false;

  try {
    const parsed = new URL(`http://${value}`);
    return parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

function isLocalStubRequest(req: Request): boolean {
  return isLoopbackAddress(req.socket.remoteAddress)
    && isLocalHostHeader(req.headers.host)
    && isLocalUrl(req.headers.origin)
    && isLocalUrl(req.headers.referer);
}

async function handleStubAuth(req: Request, next: NextFunction): Promise<boolean> {
  if (process.env.NODE_ENV !== 'development') return false;
  if (process.env.ALLOW_STUB_AUTH !== 'true') return false;

  const stubUserId = req.headers['x-stub-user-id'];
  if (!stubUserId || Array.isArray(stubUserId)) return false;

  if (!isLocalStubRequest(req)) {
    logger.warn('Rejected non-local stub auth request', {
      host: req.headers.host,
      origin: req.headers.origin,
      remoteAddress: req.socket.remoteAddress,
    });
    next(unauthorized('Stub auth is only available from localhost'));
    return true;
  }

  if (!stubAuthLoggedOnce) {
    logger.warn('!!! STUB AUTH IS ENABLED — DO NOT USE IN PRODUCTION !!!');
    stubAuthLoggedOnce = true;
  }

  const userId = Number(stubUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    next(unauthorized('Invalid X-Stub-User-Id header'));
    return true;
  }

  const user = await userModel.findById(userId);
  if (!user) {
    next(unauthorized('Stub user not found'));
    return true;
  }

  if (!user.is_active) {
    next(unauthorized('User account is deactivated'));
    return true;
  }

  req.user = {
    id: user.id,
    role: user.role as Role,
    // A stub identity holds exactly one role, so it can't switch.
    assignedRoles: [user.role as Role],
    email: user.email,
    display_name: user.display_name,
    stubAuth: true,
  };

  await securityEventModel.record({
    event_type: SecurityEventType.STUB_AUTH_USED,
    outcome: SecurityOutcome.SUCCESS,
    user_id: user.id,
    role: user.role,
    ip_address: req.ip ?? null,
    request_id: req.id ?? null,
    detail: 'Dev stub auth issued an identity',
  });
  next();
  return true;
}

/**
 * Demo sandbox auth (production-safe). Validates a demo session token signed by
 * this server (HS256 + DEMO_JWT_SECRET), never an Entra key. Completely separate
 * from the dev-only stub path: it is gated solely by ENABLE_DEMO and a valid demo
 * token, and can ONLY ever resolve to a row flagged is_demo. Returns true when it
 * has handled the request (authenticated or rejected), false to fall through to
 * real Entra auth (e.g. when a genuine Entra token was presented).
 */
async function handleDemoAuth(req: Request, next: NextFunction): Promise<boolean> {
  if (!isDemoEnabled()) return false;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.length > 8192) {
    return false;
  }
  const secret = getDemoSecret();
  if (!secret) return false;

  const token = authHeader.slice(7);
  let decoded: jwt.JwtPayload;
  try {
    decoded = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(token, secret, { algorithms: ['HS256'], clockTolerance: 5 }, (err, payload) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(payload as jwt.JwtPayload);
      });
    });
  } catch {
    // Not a valid demo token (e.g. a real Entra RS256 token) — fall through.
    return false;
  }

  // Proof of intent: only tokens explicitly minted as demo tokens are honored.
  if (decoded.demo !== true) return false;

  const demoUserId = Number(decoded.sub);
  if (!Number.isSafeInteger(demoUserId) || demoUserId <= 0) {
    next(unauthorized('Invalid demo token'));
    return true;
  }

  const user = await userModel.findById(demoUserId);
  // The is_demo column is the source of truth: a token referencing a real user's
  // id is rejected here, so a demo token can never impersonate a real account.
  if (!user || !user.is_demo) {
    next(unauthorized('Demo session is no longer valid'));
    return true;
  }
  if (user.demo_expires_at && new Date(user.demo_expires_at).getTime() < Date.now()) {
    next(unauthorized('Demo session has expired'));
    return true;
  }
  if (!user.is_active) {
    next(unauthorized('User account is deactivated'));
    return true;
  }

  req.user = {
    id: user.id,
    role: user.role as Role,
    // A demo identity holds exactly one role, so it can't switch.
    assignedRoles: [user.role as Role],
    email: user.email,
    display_name: user.display_name,
    demoMode: true,
    // Workspace id so read-only admin views can scope to this demo session only.
    demoSessionId: user.demo_session_id ?? undefined,
  };
  next();
  return true;
}

/**
 * Authenticate requests using Entra ID JWT bearer tokens.
 *
 * Flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify signature via JWKS, validate issuer + audience + expiry
 * 3. Atomically upsert user in DB by entra_id (oid claim) — race-safe
 * 4. Sync role from Entra ID `roles` claim to DB (Entra is source of truth)
 * 5. Attach user info to req.user
 */
export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  // Public demo sandbox (production-safe), checked before the dev stub path.
  if (await handleDemoAuth(req, next)) return;

  // In development, allow stub auth via X-Stub-User-Id header
  if (await handleStubAuth(req, next)) return;

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.length > 8192) {
    next(unauthorized('Missing or malformed Authorization header'));
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await verifyToken(token);
    const assignedRoles = resolveRoles(decoded.roles);
    if (assignedRoles.length === 0) {
      next(forbidden('An assigned application role is required'));
      return;
    }
    // Highest-privilege role: the DB-canonical role. Everything that touches the
    // DB (upsert, role sync, ROLE_CHANGED) uses THIS, never the switched-down
    // active role — so switching down never mutates the stored role.
    const canonicalRole = assignedRoles[0];

    // Owner allowlist: when OWNER_OIDS is set, only those Entra object ids may
    // sign in (the public demo path is separate). Empty/unset = unchanged, so
    // dev and tests are unaffected. Checked before any DB upsert. Comparison is
    // case-insensitive — Entra object ids are GUIDs, so casing in the env var must
    // never lock the owner out.
    const ownerOids = (process.env.OWNER_OIDS || '')
      .split(',')
      .map((oid) => oid.trim().toLowerCase())
      .filter(Boolean);
    const oid = typeof decoded.oid === 'string' ? decoded.oid.toLowerCase() : '';
    if (ownerOids.length > 0 && !ownerOids.includes(oid)) {
      await securityEventModel.record({
        event_type: SecurityEventType.ACCESS_DENIED,
        outcome: SecurityOutcome.FAILURE,
        entra_oid: decoded.oid,
        role: canonicalRole,
        ip_address: req.ip ?? null,
        request_id: req.id ?? null,
        detail: 'Object id not in OWNER_OIDS allowlist',
      });
      next(forbidden('Access is restricted to the application owner'));
      return;
    }

    const email = decoded.preferred_username as string;
    const displayName = decoded.name || email;

    // Atomic upsert avoids a race when two simultaneous first-login requests
    // both see "user not found" and both attempt INSERT.
    let user = await userModel.upsertByEntraId({
      entra_id: decoded.oid,
      email,
      display_name: displayName,
      role: canonicalRole,
    });

    if (user.role !== canonicalRole) {
      // Entra ID role changed — sync to DB (Entra is the source of truth) and
      // record it. Guarded by the inequality above (against the CANONICAL role),
      // so this fires only on a real role change — never when the active role was
      // merely switched down for this request.
      const previousRole = user.role;
      const synced = await userModel.updateRole(user.id, canonicalRole);
      if (synced) user = synced;
      await securityEventModel.record({
        event_type: SecurityEventType.ROLE_CHANGED,
        outcome: SecurityOutcome.SUCCESS,
        user_id: user.id,
        entra_oid: decoded.oid,
        role: canonicalRole,
        ip_address: req.ip ?? null,
        request_id: req.id ?? null,
        detail: `Role changed from ${previousRole} to ${canonicalRole}`,
        metadata: { old_role: previousRole, new_role: canonicalRole },
      });
    }

    if (!user.is_active) {
      next(unauthorized('User account is deactivated'));
      return;
    }

    // Active role for THIS request: the X-Active-Role header if it names a role
    // the principal holds, else the highest assigned role. Validated against
    // assignedRoles, so it can never escalate beyond what Entra granted.
    const activeRole = resolveActiveRole(assignedRoles, req.headers['x-active-role']);

    req.user = {
      id: user.id,
      role: activeRole,
      assignedRoles,
      email: user.email,
      display_name: user.display_name,
    };

    next();
  } catch (err) {
    // JWT error messages (e.g. "jwt expired", "invalid signature") carry no
    // secrets; the model clamps detail to the column width regardless.
    const message = err instanceof Error ? err.message : String(err);
    await securityEventModel.record({
      event_type: SecurityEventType.AUTH_FAILURE,
      outcome: SecurityOutcome.FAILURE,
      ip_address: req.ip ?? null,
      request_id: req.id ?? null,
      detail: message,
    });
    next(unauthorized('Invalid or expired token'));
  }
};

function verifyToken(token: string): Promise<EntraIdTokenPayload> {
  // Cast to tuple — jsonwebtoken types require non-empty arrays.
  const issuers = entraConfig.issuers as [string, ...string[]];
  const audiences = entraConfig.audiences as [string, ...string[]];
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        algorithms: ['RS256'],
        issuer: issuers,
        audience: audiences,
        // Small tolerance for clock drift between Entra and this host so a
        // freshly-issued token with a near-future nbf isn't spuriously rejected.
        clockTolerance: 5,
      },
      (err: Error | null, decoded: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        const payload = decoded as EntraIdTokenPayload;
        const email = payload.preferred_username || payload.upn || payload.unique_name;
        if (typeof payload.oid !== 'string' || typeof email !== 'string') {
          reject(new Error('Token missing required claims (oid, preferred_username/upn)'));
          return;
        }
        // Bound oid too (Entra object id is a GUID, ~36 chars). Token size is
        // already capped upstream, but an explicit upper bound keeps an absurd
        // value out of the DB key path regardless.
        if (payload.oid.length === 0 || payload.oid.length > 100 || email.length === 0 || email.length > 320) {
          reject(new Error('Token contains invalid required claims'));
          return;
        }
        if (payload.roles !== undefined && (!Array.isArray(payload.roles) || !payload.roles.every((role) => typeof role === 'string'))) {
          reject(new Error('Token roles claim must be an array of strings'));
          return;
        }
        payload.preferred_username = email;
        resolve(payload);
      },
    );
  });
}
