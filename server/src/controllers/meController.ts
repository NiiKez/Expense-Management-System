import { Request, Response, NextFunction } from 'express';
import { graphApiService, isGraphApiAuthError } from '../services/graphApi';
import { userModel } from '../models/user';
import { notFound } from '../utils/errors';
import { UpdatePreferencesInput } from '../validations/userSchema';
import { Role, User, UserPreferences } from '../types';
import logger from '../config/logger';
import { summarizeHttpError } from '../utils/logSanitizer';
import { getBearerToken } from '../services/managerAuthorization';

// Microsoft Graph org attributes, serialized to the client with camelCase keys
// (matching Graph + the client's ManagerEmployee convention).
type OrgAttributes = {
  department: string | null;
  jobTitle: string | null;
  employeeId: string | null;
  officeLocation: string | null;
};
type ApiGroup = { id: string; name: string | null };
type ChainMember = { id: string; displayName: string; jobTitle: string | null; department: string | null };

// MySQL returns BOOLEAN as 0/1; coerce so the API always emits real booleans.
function toBool(v: boolean | number): boolean {
  return Boolean(v);
}

function preferencesOf(user: User): UserPreferences {
  // Default to opt-in (notify) when a flag is absent, matching the column's
  // DEFAULT TRUE — a real row always carries an explicit 0/1.
  return {
    default_currency: user.default_currency ?? null,
    notify_on_submission: toBool(user.notify_on_submission ?? true),
    notify_on_decision: toBool(user.notify_on_decision ?? true),
    notify_on_comment: toBool(user.notify_on_comment ?? true),
  };
}

// The user's cached org attributes off the DB row, in the camelCase wire shape.
function orgAttributesOf(user: User): OrgAttributes {
  return {
    department: user.department ?? null,
    jobTitle: user.job_title ?? null,
    employeeId: user.employee_id ?? null,
    officeLocation: user.office_location ?? null,
  };
}

// Shape the authenticated user for the client. Identity fields come straight
// from the (Entra-synced) row; preferences are coerced to clean booleans and
// the manager is resolved to a display name for the read-only profile section.
//
// `role` reflects the request-scoped ACTIVE role (req.user.role, which may be a
// role the principal switched down to), while `roles` is the full assigned set
// ordered highest→lowest — so the client can offer a role picker. The stored
// `user.role` (always the canonical highest role) is intentionally NOT exposed
// directly; activeRole === assignedRoles[0] unless a valid switch is in effect.
async function serializeMe(
  user: User,
  { activeRole, assignedRoles }: { activeRole: Role; assignedRoles: Role[] },
) {
  let manager_name: string | null = null;
  if (user.manager_id) {
    const manager = await userModel.findById(user.manager_id);
    manager_name = manager?.display_name ?? null;
  }

  // Cached Entra groups (DB-only here — the live refresh lives at /me/directory).
  const groupRows = await userModel.getUserGroups(user.id);
  const groups: ApiGroup[] = groupRows.map((group) => ({ id: group.group_id, name: group.group_name }));

  return {
    id: user.id,
    entra_id: user.entra_id,
    email: user.email,
    display_name: user.display_name,
    role: activeRole,
    roles: assignedRoles,
    manager_id: user.manager_id,
    manager_name,
    is_active: user.is_active,
    ...orgAttributesOf(user),
    groups,
    created_at: user.created_at,
    updated_at: user.updated_at,
    ...preferencesOf(user),
  };
}

// GET /api/v1/me — current authenticated user's profile + preferences
export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await userModel.findById(req.user!.id);
    if (!user) {
      next(notFound('User'));
      return;
    }
    res.json({
      success: true,
      data: await serializeMe(user, {
        activeRole: req.user!.role,
        assignedRoles: req.user!.assignedRoles,
      }),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/me/directory — the caller's live reporting line, group memberships
// and org attributes from Microsoft Graph, persisted onto the local row/cache.
//
// Mirrors managerController.getManagerEmployees' resilience: a demo session, a
// missing bearer token, or any Graph failure serves the last-synced data from the
// DB (`source: "database"`) with a single-hop manager chain resolved from the
// cached manager_id — so the profile view always renders.
export const getMyDirectory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = getBearerToken(req);

    const respondFromDatabase = async (
      reason: 'missing_token' | 'graph_unavailable' | 'graph_consent_required',
    ): Promise<void> => {
      const user = await userModel.findById(req.user!.id);
      if (!user) {
        next(notFound('User'));
        return;
      }

      let managerChain: ChainMember[] = [];
      if (user.manager_id) {
        const manager = await userModel.findById(user.manager_id);
        if (manager) {
          managerChain = [{
            id: manager.entra_id,
            displayName: manager.display_name,
            jobTitle: manager.job_title ?? null,
            department: manager.department ?? null,
          }];
        }
      }

      const groupRows = await userModel.getUserGroups(req.user!.id);
      const groups: ApiGroup[] = groupRows.map((group) => ({ id: group.group_id, name: group.group_name }));

      res.json({
        success: true,
        data: {
          orgAttributes: orgAttributesOf(user),
          managerChain,
          groups,
        },
        meta: { source: 'database', reason },
      });
    };

    // Demo sandbox sessions have no Graph token; serve the cached directory.
    if (req.user!.demoMode || !token) {
      await respondFromDatabase('missing_token');
      return;
    }

    try {
      const [profile, chain, graphGroups] = await Promise.all([
        graphApiService.getMyOrgProfile(req.user!.id, token),
        graphApiService.getManagerChain(req.user!.id, token),
        graphApiService.getGroupMemberships(req.user!.id, token),
      ]);

      // Persist the freshly-fetched directory: org attrs onto the row, groups
      // replaced wholesale so a left group disappears.
      await userModel.setOrgAttributes(req.user!.id, {
        department: profile.department,
        job_title: profile.jobTitle,
        employee_id: profile.employeeId,
        office_location: profile.officeLocation,
      });
      await userModel.replaceUserGroups(
        req.user!.id,
        graphGroups.map((group) => ({ group_id: group.id, group_name: group.displayName })),
      );

      const orgAttributes: OrgAttributes = {
        department: profile.department,
        jobTitle: profile.jobTitle,
        employeeId: profile.employeeId,
        officeLocation: profile.officeLocation,
      };
      const managerChain: ChainMember[] = chain.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        jobTitle: member.jobTitle,
        department: member.department,
      }));
      const groups: ApiGroup[] = graphGroups.map((group) => ({ id: group.id, name: group.displayName }));

      res.json({
        success: true,
        data: { orgAttributes, managerChain, groups },
        meta: { source: 'graph' },
      });
    } catch (err) {
      logger.warn('Falling back to database-backed directory after Graph API failure', {
        err: summarizeHttpError(err),
        userId: req.user!.id,
      });
      await respondFromDatabase(isGraphApiAuthError(err) && err.reason === 'consent_required'
        ? 'graph_consent_required'
        : 'graph_unavailable');
    }
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/me/preferences — update the caller's own settings
export const updateMyPreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as UpdatePreferencesInput;
    const user = await userModel.updatePreferences(req.user!.id, body);
    if (!user) {
      next(notFound('User'));
      return;
    }
    res.json({ success: true, data: preferencesOf(user) });
  } catch (err) {
    next(err);
  }
};
