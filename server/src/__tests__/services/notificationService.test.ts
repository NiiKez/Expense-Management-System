import { notificationService } from '../../services/notificationService';
import { notificationModel } from '../../models/notification';
import { userModel } from '../../models/user';
import logger from '../../config/logger';
import { NotificationType, User } from '../../types';

jest.mock('../../models/notification');
jest.mock('../../models/user');
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockedNotificationModel = notificationModel as jest.Mocked<typeof notificationModel>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedLogger = logger as unknown as { warn: jest.Mock; error: jest.Mock };

const recipient = (overrides: Partial<User> = {}): User =>
  ({
    id: 7,
    entra_id: 'e7',
    email: 'dave@test.com',
    display_name: 'Dave',
    role: 'EMPLOYEE',
    manager_id: 2,
    is_active: true,
    notify_on_submission: true,
    notify_on_decision: true,
    notify_on_comment: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }) as User;

const actor = { id: 2, display_name: 'Bob Manager' };
const expense = { id: 10, title: 'Team lunch', submitted_by: 7 };

beforeEach(() => {
  jest.clearAllMocks();
  mockedNotificationModel.create.mockResolvedValue({} as never);
});

describe('notificationService mute preferences', () => {
  it('creates a decision notification when the recipient has it enabled', async () => {
    mockedUserModel.findById.mockResolvedValue(recipient({ notify_on_decision: true }));

    await notificationService.expenseDecision({ expense, actor, decision: 'APPROVED' });

    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(1);
    expect(mockedNotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7, type: NotificationType.EXPENSE_APPROVED }),
    );
  });

  it('skips the decision notification when the recipient muted it', async () => {
    mockedUserModel.findById.mockResolvedValue(recipient({ notify_on_decision: false }));

    await notificationService.expenseDecision({ expense, actor, decision: 'REJECTED' });

    expect(mockedNotificationModel.create).not.toHaveBeenCalled();
  });

  it('respects the 0/1 form MySQL returns for BOOLEAN columns', async () => {
    mockedUserModel.findById.mockResolvedValue(recipient({ notify_on_decision: 0 }));

    await notificationService.expenseDecision({ expense, actor, decision: 'APPROVED' });

    expect(mockedNotificationModel.create).not.toHaveBeenCalled();
  });

  it('never notifies the actor about their own action', async () => {
    mockedUserModel.findById.mockResolvedValue(recipient());

    await notificationService.expenseDecision({
      expense: { ...expense, submitted_by: actor.id },
      actor,
      decision: 'APPROVED',
    });

    expect(mockedNotificationModel.create).not.toHaveBeenCalled();
  });

  it('defaults to notify when the preference flag is absent', async () => {
    // Simulate a legacy row read without the preference columns.
    mockedUserModel.findById.mockResolvedValue(recipient({ notify_on_decision: undefined }));

    await notificationService.expenseDecision({ expense, actor, decision: 'APPROVED' });

    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(1);
  });
});

describe('notificationService fail-open + best-effort swallow', () => {
  // recipientWantsNotification fails OPEN when the preference lookup throws, and
  // safeCreate swallows a create() failure — neither may break the core action.
  it('fails open (still creates) and warns when the preference lookup rejects', async () => {
    mockedUserModel.findById.mockRejectedValue(new Error('db read failed'));

    await expect(
      notificationService.expenseDecision({ expense, actor, decision: 'APPROVED' }),
    ).resolves.toBeUndefined();

    // Fail-open: the notification is still created despite the lookup failure.
    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Failed to read notification preferences; defaulting to notify',
      expect.objectContaining({ userId: 7 }),
    );
  });

  it('swallows a create() failure (resolves, warns) rather than breaking the action', async () => {
    mockedUserModel.findById.mockResolvedValue(recipient({ notify_on_decision: true }));
    mockedNotificationModel.create.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      notificationService.expenseDecision({ expense, actor, decision: 'APPROVED' }),
    ).resolves.toBeUndefined();

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Failed to create notification',
      expect.objectContaining({ recipient: 7 }),
    );
  });

  it('does not create when the recipient row is gone (findById -> null)', async () => {
    mockedUserModel.findById.mockResolvedValue(null);

    await notificationService.expenseDecision({ expense, actor, decision: 'APPROVED' });

    expect(mockedNotificationModel.create).not.toHaveBeenCalled();
  });
});

describe('notificationService.expenseForApproval', () => {
  const SUBMITTER_ID = 7;
  const MANAGER_ID = 2;
  const approvalActor = { id: 5, display_name: 'Ada Actor' };
  const approvalExpense = { id: 10, title: 'Flight to Chicago' };

  // findById is hit twice per notified approval: once to resolve the submitter's
  // manager, once inside safeCreate to read the manager's own mute preference.
  function stubUsers(submitterManagerId: number | null): void {
    mockedUserModel.findById.mockImplementation(async (id: number) => {
      if (id === SUBMITTER_ID) return recipient({ id: SUBMITTER_ID, manager_id: submitterManagerId });
      if (id === MANAGER_ID) return recipient({ id: MANAGER_ID, notify_on_submission: true });
      return null;
    });
  }

  it('notifies the submitter\'s manager (EXPENSE_SUBMITTED) when the manager is not the actor', async () => {
    stubUsers(MANAGER_ID);

    await notificationService.expenseForApproval({
      submitterId: SUBMITTER_ID,
      actor: approvalActor,
      expense: approvalExpense,
      resubmit: false,
    });

    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(1);
    expect(mockedNotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: MANAGER_ID,
        type: NotificationType.EXPENSE_SUBMITTED,
        expense_id: approvalExpense.id,
        actor_id: approvalActor.id,
      }),
    );
  });

  it('uses EXPENSE_RESUBMITTED and a "resubmitted" message on a resubmit', async () => {
    stubUsers(MANAGER_ID);

    await notificationService.expenseForApproval({
      submitterId: SUBMITTER_ID,
      actor: approvalActor,
      expense: approvalExpense,
      resubmit: true,
    });

    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(1);
    expect(mockedNotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: MANAGER_ID,
        type: NotificationType.EXPENSE_RESUBMITTED,
        message: expect.stringContaining('resubmitted'),
      }),
    );
  });

  it('does NOT notify when the submitter\'s manager is the actor (self-approval)', async () => {
    // Manager id equals the actor id -> nobody to notify.
    stubUsers(approvalActor.id);

    await notificationService.expenseForApproval({
      submitterId: SUBMITTER_ID,
      actor: approvalActor,
      expense: approvalExpense,
      resubmit: false,
    });

    expect(mockedNotificationModel.create).not.toHaveBeenCalled();
  });

  it('does NOT notify when the submitter has no manager (manager_id null)', async () => {
    stubUsers(null);

    await notificationService.expenseForApproval({
      submitterId: SUBMITTER_ID,
      actor: approvalActor,
      expense: approvalExpense,
      resubmit: false,
    });

    expect(mockedNotificationModel.create).not.toHaveBeenCalled();
  });

  it('warns and does not throw when resolving the submitter rejects', async () => {
    mockedUserModel.findById.mockRejectedValue(new Error('db down'));

    await expect(
      notificationService.expenseForApproval({
        submitterId: SUBMITTER_ID,
        actor: approvalActor,
        expense: approvalExpense,
        resubmit: false,
      }),
    ).resolves.toBeUndefined();

    expect(mockedNotificationModel.create).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Failed to resolve manager for approval notification',
      expect.objectContaining({ submitterId: SUBMITTER_ID }),
    );
  });
});

describe('notificationService.expenseComment recipient set', () => {
  const OWNER_ID = 7;
  const OWNER_MANAGER_ID = 2;
  const THIRD_PARTY_ID = 5;

  // Owner is looked up to add their manager; each surviving recipient is looked up
  // again inside safeCreate for its mute preference.
  function stubUsers(ownerManagerId: number | null): void {
    mockedUserModel.findById.mockImplementation(async (id: number) => {
      if (id === OWNER_ID) return recipient({ id: OWNER_ID, manager_id: ownerManagerId });
      if (id === OWNER_MANAGER_ID) return recipient({ id: OWNER_MANAGER_ID, notify_on_comment: true });
      return null;
    });
  }

  const commentExpense = { id: 10, title: 'Team lunch', submitted_by: OWNER_ID };

  it('notifies BOTH the owner and their manager, excluding a third-party commenter', async () => {
    stubUsers(OWNER_MANAGER_ID);

    await notificationService.expenseComment({
      expense: commentExpense,
      actor: { id: THIRD_PARTY_ID, display_name: 'Third Party' },
    });

    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(2);
    const notifiedIds = mockedNotificationModel.create.mock.calls.map((c) => c[0].user_id);
    expect(new Set(notifiedIds)).toEqual(new Set([OWNER_ID, OWNER_MANAGER_ID]));
    expect(notifiedIds).not.toContain(THIRD_PARTY_ID);
  });

  it('removes the manager from the set when the manager is the commenter', async () => {
    stubUsers(OWNER_MANAGER_ID);

    await notificationService.expenseComment({
      expense: commentExpense,
      actor: { id: OWNER_MANAGER_ID, display_name: 'Owner Manager' },
    });

    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(1);
    expect(mockedNotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: OWNER_ID, type: NotificationType.EXPENSE_COMMENT }),
    );
  });

  it('removes the owner from the set when the owner is the commenter', async () => {
    stubUsers(OWNER_MANAGER_ID);

    await notificationService.expenseComment({
      expense: commentExpense,
      actor: { id: OWNER_ID, display_name: 'Owner' },
    });

    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(1);
    expect(mockedNotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: OWNER_MANAGER_ID }),
    );
  });

  it('notifies only the owner when the owner has no manager', async () => {
    stubUsers(null);

    await notificationService.expenseComment({
      expense: commentExpense,
      actor: { id: THIRD_PARTY_ID, display_name: 'Third Party' },
    });

    expect(mockedNotificationModel.create).toHaveBeenCalledTimes(1);
    expect(mockedNotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: OWNER_ID }),
    );
  });
});
