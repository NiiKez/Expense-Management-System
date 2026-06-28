import { Request } from 'express';
import { Role } from '../types';
import { userModel } from '../models/user';
import { graphApiService, isGraphApiAuthError } from './graphApi';
import logger from '../config/logger';
import { summarizeHttpError } from '../utils/logSanitizer';
import { forbidden } from '../utils/errors';

/**
 * Shared read-access gate for a single expense, matching getExpenseById:
 * the submitter always has access; admins see anything; managers must manage
 * the submitter (via Graph, no cached fallback); other employees are denied.
 * Throws an AppError when access is not allowed.
 */
export async function ensureCanAccessExpense(req: Request, submittedByUserId: number): Promise<void> {
  if (submittedByUserId === req.user!.id) return;
  if (req.user!.role === Role.EMPLOYEE) {
    throw forbidden();
  }
  const relationship = await verifyManagerRelationship(req, submittedByUserId, {
    allowCachedFallback: false,
    // Force a live Graph check (like approve/reject) so a manager removed from a
    // report's chain loses read access immediately rather than within the cache TTL.
    forceRefresh: true,
  });
  if (!relationship.allowed) {
    throw forbidden(relationship.reason!);
  }
}

export function getBearerToken(req: Request): string {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return '';
  }

  return header.slice(7);
}

export interface ManagerRelationshipResult {
  allowed: boolean;
  reason?: string;
}

interface ManagerRelationshipOptions {
  allowCachedFallback?: boolean;
  forceRefresh?: boolean;
}

/**
 * Verify that the current user (manager/admin) is the Graph API manager of
 * the expense submitter. Admins bypass the check. Falls back to the locally
 * cached manager_id when Graph is unavailable so the system stays usable
 * during outages.
 */
export async function verifyManagerRelationship(
  req: Request,
  submittedByUserId: number,
  options: ManagerRelationshipOptions = {},
): Promise<ManagerRelationshipResult> {
  if (req.user!.role === Role.ADMIN) {
    return { allowed: true };
  }

  const submitter = await userModel.findById(submittedByUserId);
  if (!submitter) {
    return { allowed: false, reason: 'Expense submitter not found' };
  }

  // Stub auth (dev only) has no Bearer token to call Graph with. Trust the
  // cached manager_id so local development can exercise the approval flow.
  // server.ts gates ALLOW_STUB_AUTH to NODE_ENV=development, so this path is
  // unreachable in production. The extra NODE_ENV check is defense-in-depth: the
  // cache bypass is never honored in production even if a stub flag somehow leaks,
  // so authorization no longer rests solely on the server.ts env gate.
  const stubAuth = req.user!.stubAuth === true && process.env.NODE_ENV !== 'production';
  // Demo sandbox sessions have no Graph-capable token and are fully
  // self-contained, so the seeded manager_id is authoritative within the
  // sandbox. Trust it (like stub auth) and skip Graph entirely.
  const demoMode = req.user!.demoMode === true;

  const allowFromDatabaseCache = (): ManagerRelationshipResult => {
    if (options.allowCachedFallback !== true && !stubAuth && !demoMode) {
      return {
        allowed: false,
        reason: 'Manager relationship could not be verified against Microsoft Graph.',
      };
    }

    const allowed = submitter.manager_id === req.user!.id;
    return allowed
      ? { allowed: true }
      : { allowed: false, reason: 'Manager relationship could not be verified from the local cache.' };
  };

  if (demoMode) {
    return allowFromDatabaseCache();
  }

  const token = getBearerToken(req);
  if (!token) {
    if (stubAuth) {
      return allowFromDatabaseCache();
    }
    const fallback = allowFromDatabaseCache();
    return fallback.allowed
      ? fallback
      : { allowed: false, reason: 'Manager relationship could not be verified without a bearer token.' };
  }

  try {
    const isManager = await graphApiService.isManagerOf(
      req.user!.id,
      submitter.entra_id,
      token,
      options,
    );

    if (!isManager) {
      logger.warn('Manager relationship verification failed - not a direct manager', {
        managerId: req.user!.id,
        submitterId: submittedByUserId,
      });
      return {
        allowed: false,
        reason: 'No active manager relationship found in Microsoft Graph. Escalate to an admin if reassignment is expected.',
      };
    }

    return { allowed: true };
  } catch (err) {
    logger.error('Graph API verification failed', {
      err: summarizeHttpError(err),
      managerId: req.user!.id,
      submitterId: submittedByUserId,
    });

    const fallback = allowFromDatabaseCache();
    if (fallback.allowed) {
      return fallback;
    }

    if (isGraphApiAuthError(err) && err.reason === 'consent_required') {
      return {
        allowed: false,
        reason: 'Microsoft Graph consent is required and no local manager assignment is cached for this employee.',
      };
    }

    return { allowed: false, reason: 'Unable to verify manager relationship. Please try again later.' };
  }
}
