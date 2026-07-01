import { Request, Response, NextFunction } from 'express';
import { userModel } from '../models/user';
import { Role } from '../types';
import { demoScope } from '../middleware/rbac';
import { getSingleQueryValue, parsePositiveId } from '../utils/requestParsing';
import { ORG_TREE_MAX_DEPTH } from '../utils/constants';
import { graphApiService } from '../services/graphApi';
import { getBearerToken } from '../services/managerAuthorization';
import { forbidden, notFound } from '../utils/errors';
import { summarizeHttpError } from '../utils/logSanitizer';
import logger from '../config/logger';

// One node of the org reporting hierarchy, camelCased per the response contract.
// The client threads the tree from managerId (null / not-in-set marks a root).
// Only the fields the chart actually renders are exposed — identity PII
// (entra_id/email/employee_id/office_location) is deliberately withheld.
interface OrgTreeNode {
  id: number;
  displayName: string;
  role: Role;
  jobTitle: string | null;
  department: string | null;
  managerId: number | null;
  isActive: boolean;
}

// maxDepth only bounds the MANAGER subtree walk. Clamp a valid value into
// [1, ORG_TREE_MAX_DEPTH]; anything absent/non-numeric falls back to the max.
// Throws 400 (via getSingleQueryValue) if maxDepth is repeated / non-scalar.
function resolveMaxDepth(req: Request): number {
  const raw = getSingleQueryValue(req.query.maxDepth, 'maxDepth');
  if (raw === undefined) return ORG_TREE_MAX_DEPTH;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return ORG_TREE_MAX_DEPTH;
  return Math.min(Math.max(parsed, 1), ORG_TREE_MAX_DEPTH);
}

// GET /api/v1/org/tree — the org reporting hierarchy as a flat node list.
//   ADMIN   → the whole org graph (all users), roots = managerId null OR a
//             manager not present in the returned set (forest roots).
//   MANAGER → the subtree rooted at the caller (their transitive reports),
//             walked via a recursive CTE over users.manager_id; root = [callerId].
// EMPLOYEE is blocked at the route (authorize). Demo sessions are scoped to their
// own workspace; a real caller sees only real users.
export const getOrgTree = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Scope reads to the caller's demo workspace (or real users). Throws 403 if a
    // demo session somehow lacks a workspace id — never run an unscoped query.
    const demoSessionId = demoScope(req);

    // ADMIN sees the whole org; MANAGER sees only their own subtree. maxDepth
    // bounds only the MANAGER walk, so it is resolved/validated on that path alone.
    const isAdmin = req.user!.role === Role.ADMIN;
    const { nodes: rows, truncated } = isAdmin
      ? await userModel.getAllOrgNodes(demoSessionId)
      : await userModel.getOrgSubtree(req.user!.id, resolveMaxDepth(req), demoSessionId);

    const scope: 'ADMIN' | 'MANAGER' = isAdmin ? 'ADMIN' : 'MANAGER';

    let rootIds: number[];
    if (isAdmin) {
      // Forest roots: no manager, or a manager that isn't in the returned set
      // (e.g. an inactive/filtered-out parent) — either way the client renders
      // them as top-level.
      const idSet = new Set(rows.map((r) => r.id));
      rootIds = rows
        .filter((r) => r.manager_id === null || !idSet.has(r.manager_id))
        .map((r) => r.id);
    } else {
      rootIds = [req.user!.id];
    }

    const nodes: OrgTreeNode[] = rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      role: r.role,
      jobTitle: r.job_title ?? null,
      department: r.department ?? null,
      managerId: r.manager_id,
      isActive: Boolean(r.is_active),
    }));

    // Freshness floor: the OLDEST updated_at across returned nodes, so a stale
    // node drags the reported timestamp down rather than a fresh sibling masking it.
    // Only finite timestamps count, so a malformed updated_at can't NaN the floor.
    const timestamps = rows
      .map((r) => new Date(r.updated_at).getTime())
      .filter((t) => Number.isFinite(t));
    const syncedAt: string | null =
      timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null;

    // `truncated` comes straight from the model, which over-fetches one past the
    // cap to distinguish a real clip from an exact fit.
    res.json({
      success: true,
      data: { scope, rootIds, truncated, syncedAt, nodes },
      meta: { count: nodes.length },
    });
  } catch (err) {
    next(err);
  }
};

// One user's detail for the org-chart node modal. `source` tells the client
// whether contact fields + groups came live from Microsoft Graph ('directory')
// or only from the cached DB row ('local' — demo/stub sessions, or a Graph call
// that failed). identity PII beyond what the modal shows is never returned.
interface OrgUserDetail {
  id: number;
  displayName: string;
  role: Role;
  jobTitle: string | null;
  department: string | null;
  email: string | null;
  officeLocation: string | null;
  employeeId: string | null;
  mobilePhone: string | null;
  businessPhones: string[];
  isActive: boolean;
  groups: { id: string; name: string | null }[];
  source: 'directory' | 'local';
}

// GET /api/v1/org/users/:id — the detail behind an org-chart node. Scoped and
// authorized server-side: a demo caller sees only their workspace; a MANAGER may
// open only themselves or someone in their subtree; ADMIN any in-scope user. The
// DB row is the always-available baseline (works in demo/stub); a real Entra
// session additionally enriches contact numbers + group memberships from Graph.
export const getOrgUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const targetId = parsePositiveId(req.params.id, 'id');
    const demoSessionId = demoScope(req);

    // Scoped lookup: absent or out-of-scope → 404 (never reveal existence across
    // the demo boundary or to a real caller peeking at demo rows).
    const target = await userModel.findOrgUser(targetId, demoSessionId);
    if (!target) {
      throw notFound('User');
    }

    // Re-check visibility from the token, never the clicked id: a MANAGER may
    // only open themselves or a transitive report; ADMIN any in-scope user.
    if (req.user!.role !== Role.ADMIN && target.id !== req.user!.id) {
      const allowed = await userModel.isInSubtree(
        req.user!.id,
        target.id,
        ORG_TREE_MAX_DEPTH,
        demoSessionId,
      );
      if (!allowed) {
        throw forbidden();
      }
    }

    // DB baseline — present for every session, including demo/stub.
    const detail: OrgUserDetail = {
      id: target.id,
      displayName: target.display_name,
      role: target.role,
      jobTitle: target.job_title ?? null,
      department: target.department ?? null,
      email: target.email ?? null,
      officeLocation: target.office_location ?? null,
      employeeId: target.employee_id ?? null,
      mobilePhone: null,
      businessPhones: [],
      isActive: Boolean(target.is_active),
      groups: [],
      source: 'local',
    };

    // Skip Graph for demo sessions (synthetic *.demo.local identities have no
    // directory presence). Otherwise best-effort enrich; ANY failure (missing
    // consent, a non-Entra stub token, throttling) silently keeps the DB baseline
    // so the modal always renders.
    if (!req.user!.demoMode) {
      try {
        const token = getBearerToken(req);
        const [profile, groups] = await Promise.all([
          graphApiService.getUserById(target.entra_id, token),
          graphApiService.getUserGroups(target.entra_id, token),
        ]);
        detail.jobTitle = profile.jobTitle ?? detail.jobTitle;
        detail.department = profile.department ?? detail.department;
        detail.email = profile.mail ?? detail.email;
        detail.officeLocation = profile.officeLocation ?? detail.officeLocation;
        detail.employeeId = profile.employeeId ?? detail.employeeId;
        detail.mobilePhone = profile.mobilePhone;
        detail.businessPhones = profile.businessPhones;
        detail.groups = groups.map((g) => ({ id: g.id, name: g.displayName }));
        detail.source = 'directory';
      } catch (err) {
        logger.warn('Org user detail: Graph enrichment failed; serving DB baseline', {
          err: summarizeHttpError(err),
          targetId: target.id,
        });
      }
    }

    res.json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
};
