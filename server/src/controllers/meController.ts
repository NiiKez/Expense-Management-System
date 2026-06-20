import { Request, Response, NextFunction } from 'express';
import { userModel } from '../models/user';
import { notFound } from '../utils/errors';
import { UpdatePreferencesInput } from '../validations/userSchema';
import { User, UserPreferences } from '../types';

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

// Shape the authenticated user for the client. Identity fields come straight
// from the (Entra-synced) row; preferences are coerced to clean booleans and
// the manager is resolved to a display name for the read-only profile section.
async function serializeMe(user: User) {
  let manager_name: string | null = null;
  if (user.manager_id) {
    const manager = await userModel.findById(user.manager_id);
    manager_name = manager?.display_name ?? null;
  }

  return {
    id: user.id,
    entra_id: user.entra_id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    manager_id: user.manager_id,
    manager_name,
    is_active: user.is_active,
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
    res.json({ success: true, data: await serializeMe(user) });
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
