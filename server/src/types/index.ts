// ============================================================
// Enums
// ============================================================

export enum Role {
  EMPLOYEE = 'EMPLOYEE',
  MANAGER = 'MANAGER',
  ADMIN = 'ADMIN',
}

export enum Status {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum Category {
  TRAVEL = 'TRAVEL',
  MEALS = 'MEALS',
  SUPPLIES = 'SUPPLIES',
  EQUIPMENT = 'EQUIPMENT',
  SOFTWARE = 'SOFTWARE',
  TRAINING = 'TRAINING',
  OTHER = 'OTHER',
}

export enum AuditAction {
  SUBMITTED = 'SUBMITTED',
  RESUBMITTED = 'RESUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  OVERRIDDEN = 'OVERRIDDEN',
  UPDATED = 'UPDATED',
  DELETED = 'DELETED',
}

export enum NotificationType {
  EXPENSE_SUBMITTED = 'EXPENSE_SUBMITTED',
  EXPENSE_RESUBMITTED = 'EXPENSE_RESUBMITTED',
  EXPENSE_APPROVED = 'EXPENSE_APPROVED',
  EXPENSE_REJECTED = 'EXPENSE_REJECTED',
  EXPENSE_COMMENT = 'EXPENSE_COMMENT',
}

// ============================================================
// Interfaces
// ============================================================

export interface User {
  id: number;
  entra_id: string;
  email: string;
  display_name: string;
  role: Role;
  manager_id: number | null;
  is_active: boolean;
  // In-app preferences (see UserPreferences). MySQL returns BOOLEAN as 0/1, so
  // notify_* are number-or-boolean at runtime — coerce before serializing.
  // Optional in the type so partial test mocks of a row stay valid; a real row
  // (SELECT *) always has them, and consumers default to "notify" when absent.
  default_currency?: string | null;
  notify_on_submission?: boolean | number;
  notify_on_decision?: boolean | number;
  notify_on_comment?: boolean | number;
  created_at: Date;
  updated_at: Date;
}

// Self-service settings a user can change in-app (everything else is Entra-owned).
export interface UserPreferences {
  default_currency: string | null;
  notify_on_submission: boolean;
  notify_on_decision: boolean;
  notify_on_comment: boolean;
}

export interface Expense {
  id: number;
  submitted_by: number;
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  category: Category;
  expense_date: Date;
  status: Status;
  approved_by: number | null;
  rejection_reason: string | null;
  version: number;
  deleted_at?: Date | null;
  deleted_by?: number | null;
  created_at: Date;
  updated_at: Date;
  // Joined from users in admin/manager list queries.
  submitter_name?: string;
  submitter_email?: string;
}

export interface Receipt {
  id: number;
  expense_id: number;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  uploaded_at: Date;
}

export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  expense_id: number | null;
  actor_id: number | null;
  message: string;
  is_read: boolean | number;
  created_at: Date;
}

export interface Comment {
  id: number;
  expense_id: number;
  author_id: number;
  body: string;
  created_at: Date;
  // Joined from users for display.
  author_name?: string;
  author_role?: Role;
}

export interface AuditLog {
  id: number;
  expense_id: number;
  action: AuditAction;
  performed_by: number;
  old_status: Status | null;
  new_status: Status | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: Date;
}

// ============================================================
// Stats DTOs
// ============================================================

export interface StatusCount { status: Status; count: number; total: number }
export interface CategoryTotal { category: Category; count: number; total: number }
export interface MonthlyTotal { month: string; total: number }

export interface MeStats {
  totals: { submitted: number; pending: number; approved: number; rejected: number };
  approvedAmountMonth: number;
  // ISO 4217 code that every money total in this DTO is normalized to.
  baseCurrency: string;
  byCategory: CategoryTotal[];
  monthly: MonthlyTotal[];
}
export interface ManagerStats {
  pendingApprovals: number;
  teamSize: number;
  teamSpendMonth: number;
  approvedMonth: number;
  baseCurrency: string;
  byCategory: CategoryTotal[];
  monthly: MonthlyTotal[];
}
export interface AdminStats {
  orgSpendMonth: number;
  pendingOrgWide: number;
  activeUsers: number;
  approvedMonth: number;
  baseCurrency: string;
  byCategory: CategoryTotal[];
  monthly: MonthlyTotal[];
}

// ============================================================
// Express Request augmentation
// ============================================================

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: Role;
        email: string;
        display_name: string;
        stubAuth?: boolean;
      };
      // Per-request correlation id, set by the request-id middleware and echoed
      // back as the X-Request-Id response header so access logs, error logs, and
      // a client-reported id all point at the same request.
      id?: string;
    }
  }
}
