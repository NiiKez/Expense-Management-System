import { Status, Category, AuditAction } from '../types';
import { FX_RATES } from './fx';

// String constant arrays for validation and iteration
export const STATUSES = Object.values(Status) as [string, ...string[]];
export const CATEGORIES = Object.values(Category) as [string, ...string[]];
export const AUDIT_ACTIONS = Object.values(AuditAction) as [string, ...string[]];

// Pagination defaults
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
// Upper bound on the page number. Without it, a huge `page` produces a massive
// SQL OFFSET (deep-pagination DoS); clamp it to a sane ceiling.
export const MAX_PAGE = 100_000;

// Upper bound on rows returned by a single CSV export. Exports that hit this
// cap are logged so a truncated download never silently reads as "complete".
export const EXPORT_MAX_ROWS = 5000;

// Defensive ceiling on the admin "all users" list, which is returned unpaginated
// (the client needs the full set for name resolution). Hitting it is logged so
// the truncation is never silent.
export const MAX_USER_LIST = 10_000;

// Max depth walked when expanding a manager's org subtree (recursive CTE guard).
export const ORG_TREE_MAX_DEPTH = 10;
// Defensive ceiling on nodes returned by the org-tree endpoint (bounds the graph
// the client must render). Hitting it is logged so truncation is never silent.
export const MAX_ORG_NODES = 5000;

// Currency
export const DEFAULT_CURRENCY = 'USD';

// Currencies the app recognizes — the set we have FX rates for. Used to validate
// the user's default-currency preference and the expense currency.
export const CURRENCY_CODES = Object.keys(FX_RATES) as [string, ...string[]];

// Single source of truth for "is this a supported currency?": a 3-letter ISO 4217
// shape that is one of CURRENCY_CODES. Expects an already-uppercased value. Shared
// by the expense-currency and user-default-currency validators so the two can't
// drift apart. CURRENCY_CODES are uppercase, so the regex also fixes the shape.
export const isSupportedCurrency = (value: string): boolean =>
  /^[A-Z]{3}$/.test(value) && (CURRENCY_CODES as readonly string[]).includes(value);

// Amount limits
export const MIN_EXPENSE_AMOUNT = 0.01;
export const MAX_EXPENSE_AMOUNT = 99_999_999.99;

// Expense date bounds (relative to "today" at validation time)
export const MAX_EXPENSE_DATE_PAST_YEARS = 5;

// Rejection reason
export const MAX_REJECTION_REASON_LENGTH = 500;
