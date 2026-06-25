import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { Role } from '../types';
import { entraConfig } from '../config/entra';
import { forbidden, unauthorized } from '../utils/errors';
import logger from '../config/logger';
import { userModel } from '../models/user';

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
 * Resolve the user's role from the Entra ID `roles` claim.
 *
 * If multiple app roles are assigned, the highest-privilege role wins:
 * ADMIN > MANAGER > EMPLOYEE. Tokens without a recognized app role are denied.
 */
function resolveRole(roles?: unknown): Role | null {
  if (!Array.isArray(roles) || roles.length === 0) return null;
  if (roles.includes(Role.ADMIN)) return Role.ADMIN;
  if (roles.includes(Role.MANAGER)) return Role.MANAGER;
  if (roles.includes(Role.EMPLOYEE)) return Role.EMPLOYEE;
  return null;
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
    email: user.email,
    display_name: user.display_name,
    stubAuth: true,
  };

  logger.debug('Stub auth: authenticated as user', { userId: user.id, role: user.role });
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
    const entraRole = resolveRole(decoded.roles);
    if (!entraRole) {
      next(forbidden('An assigned application role is required'));
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
      role: entraRole,
    });

    if (user.role !== entraRole) {
      // Entra ID role changed — sync to DB
      const synced = await userModel.updateRole(user.id, entraRole);
      if (synced) user = synced;
      logger.debug('Synced role from Entra ID', { userId: user.id, newRole: entraRole });
    }

    if (!user.is_active) {
      next(unauthorized('User account is deactivated'));
      return;
    }

    req.user = {
      id: user.id,
      role: entraRole,
      email: user.email,
      display_name: user.display_name,
    };

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('JWT verification failed', { error: message });
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
