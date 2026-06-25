import { z } from 'zod';
import { CATEGORIES, CURRENCY_CODES, isSupportedCurrency } from '../utils/constants';
import {
  MIN_EXPENSE_AMOUNT,
  MAX_EXPENSE_AMOUNT,
  MAX_EXPENSE_DATE_PAST_YEARS,
  MAX_REJECTION_REASON_LENGTH,
} from '../utils/constants';
import { isStrictDate } from '../utils/requestParsing';

// Reject C0 control characters in free-text fields. Shared by title/description
// (and mirrored by reason/comment body below) so a crafted value can't smuggle
// control bytes into stored text. \t (\x09) and \n (\x0A) are excluded so the
// multi-line/tabbed values comments allow stay valid where reused.
// eslint-disable-next-line no-control-regex -- intentional: rejecting control characters
const hasNoControlChars = (v: string) => !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(v);

// Currency: a 3-letter ISO 4217 code that, once uppercased, must be one the app
// actually supports (we have an FX rate for it). An unsupported code like 'XYZ'
// would otherwise be summed at face value — reject it the same way the user
// default-currency preference is validated.
const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'Currency must be a 3-letter ISO 4217 code')
  .transform((value) => value.toUpperCase())
  .refine(
    // Shared membership check with the user default-currency validator.
    (value) => isSupportedCurrency(value),
    { message: `Currency must be one of: ${CURRENCY_CODES.join(', ')}` },
  );

// Amount: 2 decimal places max (matches DB DECIMAL(10,2)).
// Why multipleOf isn't enough: floating-point quirks would let 49.99999 slip past
// some checks. Round-trip through cents instead.
const amountNumberSchema = z
  .coerce.number({ invalid_type_error: 'Amount must be a number' })
  .finite('Amount must be a finite number')
  .min(MIN_EXPENSE_AMOUNT, `Amount must be at least ${MIN_EXPENSE_AMOUNT}`)
  .max(MAX_EXPENSE_AMOUNT, `Amount must be at most ${MAX_EXPENSE_AMOUNT}`)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
    'Amount must have at most 2 decimal places',
  );

// Guard the coercion: z.coerce.number runs JS Number(), and Number([5]) === 5,
// so a JSON body like {"amount":[5]} would otherwise be accepted as 5. Reject
// anything that isn't already a string or number before coercion runs.
const amountSchema = z.preprocess(
  (v) => (typeof v === 'string' || typeof v === 'number' ? v : NaN),
  amountNumberSchema,
);

const expenseDateSchema = z
  .string()
  .refine(isStrictDate, 'Expense date must be a real date in YYYY-MM-DD format')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return d.getTime() <= todayUTC.getTime();
  }, 'Expense date cannot be in the future')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    const minDate = new Date();
    minDate.setUTCFullYear(minDate.getUTCFullYear() - MAX_EXPENSE_DATE_PAST_YEARS);
    return d.getTime() >= minDate.getTime();
  }, `Expense date cannot be more than ${MAX_EXPENSE_DATE_PAST_YEARS} years in the past`);

export const createExpenseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or fewer')
    .refine(hasNoControlChars, 'Title contains invalid control characters'),
  description: z
    .string()
    .trim()
    .max(5000, 'Description must be 5000 characters or fewer')
    .refine(hasNoControlChars, 'Description contains invalid control characters')
    .nullable()
    .optional(),
  amount: amountSchema,
  currency: currencySchema.default('USD'),
  category: z.enum(CATEGORIES as [string, ...string[]], {
    errorMap: () => ({ message: `Category must be one of: ${CATEGORIES.join(', ')}` }),
  }),
  expense_date: expenseDateSchema,
}).strict();

const editableExpenseFields = {
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or fewer')
    .refine(hasNoControlChars, 'Title contains invalid control characters')
    .optional(),
  description: z
    .string()
    .trim()
    .max(5000, 'Description must be 5000 characters or fewer')
    .refine(hasNoControlChars, 'Description contains invalid control characters')
    .nullable()
    .optional(),
  amount: amountSchema.optional(),
  currency: currencySchema.optional(),
  category: z
    .enum(CATEGORIES as [string, ...string[]], {
      errorMap: () => ({ message: `Category must be one of: ${CATEGORIES.join(', ')}` }),
    })
    .optional(),
  expense_date: expenseDateSchema.optional(),
};

export const updateExpenseSchema = z
  .object(editableExpenseFields)
  .strict()
  .refine(
    (v) => Object.values(v).some((val) => val !== undefined),
    { message: 'Update body must contain at least one field' },
  );

// Resubmit reuses the same editable fields but, unlike update, allows an empty
// body — resubmitting a rejected expense unchanged is valid.
export const resubmitExpenseSchema = z.object(editableExpenseFields).strict();

// Why: rejection reason was previously validated inline in the controller — moving
// it to a schema keeps validation centralized and lets us reject control characters.
export const rejectExpenseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Rejection reason is required')
    .max(MAX_REJECTION_REASON_LENGTH, `Rejection reason must be ${MAX_REJECTION_REASON_LENGTH} characters or fewer`)
    .refine(hasNoControlChars, 'Rejection reason contains invalid control characters'),
}).strict();

// Comment body: 1–2000 chars, control characters rejected (newlines/tabs kept).
export const createCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(2000, 'Comment must be 2000 characters or fewer')
    .refine(hasNoControlChars, 'Comment contains invalid control characters'),
}).strict();

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ResubmitExpenseInput = z.infer<typeof resubmitExpenseSchema>;
export type RejectExpenseInput = z.infer<typeof rejectExpenseSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
