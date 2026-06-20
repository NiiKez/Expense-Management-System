import { notificationModel } from '../models/notification';
import { userModel } from '../models/user';
import { NotificationType, Expense } from '../types';
import logger from '../config/logger';

interface Actor {
  id: number;
  display_name: string;
}

// Keep titles short in the message so name + verb + title stays well under the
// 500-char column limit.
function shortTitle(title: string): string {
  return title.length > 120 ? `${title.slice(0, 117)}…` : title;
}

// Which mute preference governs each notification type. The recipient owns the
// preference, so the check is keyed on the user being notified (not the actor).
const MUTE_FIELD: Record<
  NotificationType,
  'notify_on_submission' | 'notify_on_decision' | 'notify_on_comment'
> = {
  [NotificationType.EXPENSE_SUBMITTED]: 'notify_on_submission',
  [NotificationType.EXPENSE_RESUBMITTED]: 'notify_on_submission',
  [NotificationType.EXPENSE_APPROVED]: 'notify_on_decision',
  [NotificationType.EXPENSE_REJECTED]: 'notify_on_decision',
  [NotificationType.EXPENSE_COMMENT]: 'notify_on_comment',
};

// Respect the recipient's settings. Defaults are opt-in (column DEFAULT TRUE),
// so a brand-new user is notified unless they explicitly mute a category. On any
// lookup failure we fail open and let the notification through.
async function recipientWantsNotification(userId: number, type: NotificationType): Promise<boolean> {
  try {
    const user = await userModel.findById(userId);
    if (!user) return false; // recipient gone — nothing to deliver
    const pref = user[MUTE_FIELD[type]];
    // Absent flag → notify (matches the column's DEFAULT TRUE).
    return pref === undefined ? true : Boolean(pref);
  } catch (err) {
    logger.warn('Failed to read notification preferences; defaulting to notify', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      type,
    });
    return true;
  }
}

async function safeCreate(data: {
  user_id: number;
  type: NotificationType;
  expense_id?: number | null;
  actor_id?: number | null;
  message: string;
}): Promise<void> {
  try {
    if (!(await recipientWantsNotification(data.user_id, data.type))) return;
    await notificationModel.create(data);
  } catch (err) {
    // Notifications are best-effort — never let a failure break the core action.
    logger.warn('Failed to create notification', {
      error: err instanceof Error ? err.message : String(err),
      type: data.type,
      recipient: data.user_id,
    });
  }
}

export const notificationService = {
  /** Notify the submitter that their expense was approved or rejected. */
  async expenseDecision(params: {
    expense: Pick<Expense, 'id' | 'title' | 'submitted_by'>;
    actor: Actor;
    decision: 'APPROVED' | 'REJECTED';
  }): Promise<void> {
    const { expense, actor, decision } = params;
    if (expense.submitted_by === actor.id) return;
    const verb = decision === 'APPROVED' ? 'approved' : 'rejected';
    await safeCreate({
      user_id: expense.submitted_by,
      type: decision === 'APPROVED' ? NotificationType.EXPENSE_APPROVED : NotificationType.EXPENSE_REJECTED,
      expense_id: expense.id,
      actor_id: actor.id,
      message: `${actor.display_name} ${verb} your expense "${shortTitle(expense.title)}"`,
    });
  },

  /** Notify the submitter's manager that an expense is waiting for approval. */
  async expenseForApproval(params: {
    submitterId: number;
    actor: Actor;
    expense: Pick<Expense, 'id' | 'title'>;
    resubmit: boolean;
  }): Promise<void> {
    const { submitterId, actor, expense, resubmit } = params;
    try {
      const submitter = await userModel.findById(submitterId);
      const managerId = submitter?.manager_id;
      if (!managerId || managerId === actor.id) return;
      await safeCreate({
        user_id: managerId,
        type: resubmit ? NotificationType.EXPENSE_RESUBMITTED : NotificationType.EXPENSE_SUBMITTED,
        expense_id: expense.id,
        actor_id: actor.id,
        message: `${actor.display_name} ${resubmit ? 'resubmitted' : 'submitted'} "${shortTitle(expense.title)}" for your approval`,
      });
    } catch (err) {
      logger.warn('Failed to resolve manager for approval notification', {
        error: err instanceof Error ? err.message : String(err),
        submitterId,
      });
    }
  },

  /** Notify the other party (expense owner + their manager) of a new comment. */
  async expenseComment(params: {
    expense: Pick<Expense, 'id' | 'title' | 'submitted_by'>;
    actor: Actor;
  }): Promise<void> {
    const { expense, actor } = params;
    try {
      const recipients = new Set<number>([expense.submitted_by]);
      const owner = await userModel.findById(expense.submitted_by);
      if (owner?.manager_id) recipients.add(owner.manager_id);
      recipients.delete(actor.id);
      for (const userId of recipients) {
        await safeCreate({
          user_id: userId,
          type: NotificationType.EXPENSE_COMMENT,
          expense_id: expense.id,
          actor_id: actor.id,
          message: `${actor.display_name} commented on "${shortTitle(expense.title)}"`,
        });
      }
    } catch (err) {
      logger.warn('Failed to build comment notifications', {
        error: err instanceof Error ? err.message : String(err),
        expenseId: expense.id,
      });
    }
  },
};
