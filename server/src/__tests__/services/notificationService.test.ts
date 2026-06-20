import { notificationService } from '../../services/notificationService';
import { notificationModel } from '../../models/notification';
import { userModel } from '../../models/user';
import { NotificationType, User } from '../../types';

jest.mock('../../models/notification');
jest.mock('../../models/user');

const mockedNotificationModel = notificationModel as jest.Mocked<typeof notificationModel>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;

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
