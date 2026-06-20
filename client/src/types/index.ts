export const Role = {
  EMPLOYEE: 'EMPLOYEE',
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const Status = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type Status = (typeof Status)[keyof typeof Status];

export const Category = {
  TRAVEL: 'TRAVEL',
  MEALS: 'MEALS',
  SUPPLIES: 'SUPPLIES',
  EQUIPMENT: 'EQUIPMENT',
  SOFTWARE: 'SOFTWARE',
  TRAINING: 'TRAINING',
  OTHER: 'OTHER',
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const AuditAction = {
  SUBMITTED: 'SUBMITTED',
  RESUBMITTED: 'RESUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  OVERRIDDEN: 'OVERRIDDEN',
  UPDATED: 'UPDATED',
  DELETED: 'DELETED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface User {
  id: number;
  entra_id: string;
  email: string;
  display_name: string;
  role: Role;
  manager_id: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Present on the GET /me payload (real + stub auth via the API). Optional
  // because the static stub-user objects used pre-fetch don't carry them.
  manager_name?: string | null;
  default_currency?: string | null;
  notify_on_submission?: boolean;
  notify_on_decision?: boolean;
  notify_on_comment?: boolean;
}

// Self-service settings editable on the Settings page.
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
  expense_date: string;
  status: Status;
  approved_by: number | null;
  rejection_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  submitter_name?: string;
  submitter_email?: string;
}

export interface AuditLog {
  id: number;
  expense_id: number;
  action: string;
  performed_by: number;
  old_status: Status | null;
  new_status: Status | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface Receipt {
  id: number;
  expense_id: number;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
}

export interface Comment {
  id: number
  expense_id: number
  author_id: number
  author_name?: string
  author_role?: Role
  body: string
  created_at: string
}

export const NotificationType = {
  EXPENSE_SUBMITTED: 'EXPENSE_SUBMITTED',
  EXPENSE_RESUBMITTED: 'EXPENSE_RESUBMITTED',
  EXPENSE_APPROVED: 'EXPENSE_APPROVED',
  EXPENSE_REJECTED: 'EXPENSE_REJECTED',
  EXPENSE_COMMENT: 'EXPENSE_COMMENT',
} as const
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType]

// Named AppNotification to avoid clashing with the DOM `Notification` global.
export interface AppNotification {
  id: number
  user_id: number
  type: NotificationType
  expense_id: number | null
  actor_id: number | null
  message: string
  is_read: boolean | number
  created_at: string
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  meta?: ResponseMeta;
  error?: { message: string; statusCode: number };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination?: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface ResponseMeta {
  source?: 'graph' | 'database';
  reason?: 'missing_token' | 'graph_unavailable' | 'graph_consent_required' | 'graph_no_direct_reports';
  forceRefresh?: boolean;
  unread?: number;
}

export interface ManagerEmployee {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  appUser: {
    id: number;
    email: string;
    display_name: string;
    role: Role;
    manager_id: number | null;
    is_active: boolean;
  } | null;
}

export interface CategoryTotal { category: Category; count: number; total: number }
export interface MonthlyTotal { month: string; total: number }
export interface MeStats {
  totals: { submitted: number; pending: number; approved: number; rejected: number };
  approvedAmountMonth: number;
  baseCurrency: string;
  byCategory: CategoryTotal[];
  monthly: MonthlyTotal[];
}
export interface ManagerStats {
  pendingApprovals: number; teamSize: number; teamSpendMonth: number; approvedMonth: number;
  baseCurrency: string;
  byCategory: CategoryTotal[]; monthly: MonthlyTotal[];
}
export interface AdminStats {
  orgSpendMonth: number; pendingOrgWide: number; activeUsers: number; approvedMonth: number;
  baseCurrency: string;
  byCategory: CategoryTotal[]; monthly: MonthlyTotal[];
}
