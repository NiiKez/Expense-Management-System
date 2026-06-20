import {
  createExpenseSchema,
  updateExpenseSchema,
  resubmitExpenseSchema,
  rejectExpenseSchema,
  createCommentSchema,
} from '../../validations/expenseSchema';
import { Category } from '../../types';

// ── Date helpers (UTC, relative to validation-time "today") ────────
// The schema bounds dates against `new Date()` at parse time, so tests must
// compute dates relative to now rather than hardcoding calendar values.
function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
function offsetDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}
function offsetYears(base: Date, years: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear() + years, base.getUTCMonth(), base.getUTCDate()));
}

const TODAY = ymd(todayUtc());
const YESTERDAY = ymd(offsetDays(todayUtc(), -1));
const TOMORROW = ymd(offsetDays(todayUtc(), 2));
const TOO_OLD = ymd(offsetYears(todayUtc(), -6)); // > MAX_EXPENSE_DATE_PAST_YEARS (5)

const validCreate = () => ({
  title: 'Taxi to airport',
  amount: 42.5,
  currency: 'usd',
  category: Category.TRAVEL,
  expense_date: YESTERDAY,
});

describe('createExpenseSchema', () => {
  it('accepts a valid payload and normalizes currency to uppercase', () => {
    const result = createExpenseSchema.safeParse(validCreate());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('USD');
  });

  it('defaults currency to USD when omitted', () => {
    const { currency: _omit, ...rest } = validCreate();
    const result = createExpenseSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('USD');
  });

  it('trims the title and rejects an empty/whitespace title', () => {
    expect(createExpenseSchema.safeParse({ ...validCreate(), title: '   ' }).success).toBe(false);
    const ok = createExpenseSchema.safeParse({ ...validCreate(), title: '  Lunch  ' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.title).toBe('Lunch');
  });

  it('rejects a title longer than 255 characters', () => {
    expect(createExpenseSchema.safeParse({ ...validCreate(), title: 'x'.repeat(256) }).success).toBe(false);
  });

  it('rejects a currency that is not a 3-letter code', () => {
    expect(createExpenseSchema.safeParse({ ...validCreate(), currency: 'US' }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...validCreate(), currency: 'US1' }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...validCreate(), currency: 'DOLLARS' }).success).toBe(false);
  });

  it('rejects an unknown category', () => {
    expect(createExpenseSchema.safeParse({ ...validCreate(), category: 'BRIBERY' }).success).toBe(false);
  });

  describe('amount', () => {
    it('rejects amounts at or below zero', () => {
      expect(createExpenseSchema.safeParse({ ...validCreate(), amount: 0 }).success).toBe(false);
      expect(createExpenseSchema.safeParse({ ...validCreate(), amount: -1 }).success).toBe(false);
    });

    it('rejects amounts above the maximum', () => {
      expect(createExpenseSchema.safeParse({ ...validCreate(), amount: 100_000_000 }).success).toBe(false);
    });

    it('rejects more than two decimal places', () => {
      expect(createExpenseSchema.safeParse({ ...validCreate(), amount: 1.005 }).success).toBe(false);
    });

    it('rejects non-finite amounts', () => {
      expect(createExpenseSchema.safeParse({ ...validCreate(), amount: Infinity }).success).toBe(false);
      expect(createExpenseSchema.safeParse({ ...validCreate(), amount: NaN }).success).toBe(false);
    });

    it('coerces a numeric string', () => {
      const result = createExpenseSchema.safeParse({ ...validCreate(), amount: '10.50' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.amount).toBe(10.5);
    });
  });

  describe('expense_date', () => {
    it('accepts today and a recent past date', () => {
      expect(createExpenseSchema.safeParse({ ...validCreate(), expense_date: TODAY }).success).toBe(true);
      expect(createExpenseSchema.safeParse({ ...validCreate(), expense_date: YESTERDAY }).success).toBe(true);
    });

    it('rejects a future date', () => {
      expect(createExpenseSchema.safeParse({ ...validCreate(), expense_date: TOMORROW }).success).toBe(false);
    });

    it('rejects a date more than 5 years in the past', () => {
      expect(createExpenseSchema.safeParse({ ...validCreate(), expense_date: TOO_OLD }).success).toBe(false);
    });

    it('rejects malformed / non-real dates', () => {
      expect(createExpenseSchema.safeParse({ ...validCreate(), expense_date: '2026-13-01' }).success).toBe(false);
      expect(createExpenseSchema.safeParse({ ...validCreate(), expense_date: '2026-02-30' }).success).toBe(false);
      expect(createExpenseSchema.safeParse({ ...validCreate(), expense_date: '06/15/2026' }).success).toBe(false);
    });
  });
});

describe('updateExpenseSchema', () => {
  it('requires at least one field', () => {
    expect(updateExpenseSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single editable field', () => {
    expect(updateExpenseSchema.safeParse({ title: 'Updated title' }).success).toBe(true);
  });

  // Regression guard: date bounds ARE enforced on update, not only on create.
  it('rejects a future expense_date on update', () => {
    expect(updateExpenseSchema.safeParse({ expense_date: TOMORROW }).success).toBe(false);
  });

  it('rejects a >5-year-old expense_date on update', () => {
    expect(updateExpenseSchema.safeParse({ expense_date: TOO_OLD }).success).toBe(false);
  });

  it('rejects an over-precise amount on update', () => {
    expect(updateExpenseSchema.safeParse({ amount: 1.005 }).success).toBe(false);
  });

  // Privileged/unknown fields are stripped, so they can never reach the model.
  // A body of only unknown keys therefore fails the "at least one field" rule.
  it('strips unknown/privileged fields (status, submitted_by, version)', () => {
    const result = updateExpenseSchema.safeParse({
      title: 'Legit edit',
      status: 'APPROVED',
      submitted_by: 999,
      approved_by: 1,
      version: 99,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ title: 'Legit edit' });
      expect(result.data).not.toHaveProperty('status');
      expect(result.data).not.toHaveProperty('submitted_by');
    }
  });

  it('rejects a body containing only unknown fields', () => {
    expect(updateExpenseSchema.safeParse({ status: 'APPROVED' }).success).toBe(false);
  });
});

describe('resubmitExpenseSchema', () => {
  it('allows an empty body (resubmit unchanged)', () => {
    expect(resubmitExpenseSchema.safeParse({}).success).toBe(true);
  });

  it('still enforces date bounds when fields are edited', () => {
    expect(resubmitExpenseSchema.safeParse({ expense_date: TOMORROW }).success).toBe(false);
    expect(resubmitExpenseSchema.safeParse({ amount: 2.001 }).success).toBe(false);
  });

  it('accepts valid edited fields', () => {
    expect(resubmitExpenseSchema.safeParse({ amount: 12.34, expense_date: YESTERDAY }).success).toBe(true);
  });
});

describe('rejectExpenseSchema', () => {
  it('requires a non-empty reason and trims it', () => {
    expect(rejectExpenseSchema.safeParse({ reason: '   ' }).success).toBe(false);
    const ok = rejectExpenseSchema.safeParse({ reason: '  missing receipt  ' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.reason).toBe('missing receipt');
  });

  it('rejects control characters', () => {
    expect(rejectExpenseSchema.safeParse({ reason: 'bad\x00reason' }).success).toBe(false);
  });

  it('rejects a reason over the length limit', () => {
    expect(rejectExpenseSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('createCommentSchema', () => {
  it('accepts a normal comment and keeps newlines/tabs', () => {
    expect(createCommentSchema.safeParse({ body: 'line1\nline2\ttabbed' }).success).toBe(true);
  });

  it('rejects an empty/whitespace body', () => {
    expect(createCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
  });

  it('rejects non-newline/tab control characters', () => {
    expect(createCommentSchema.safeParse({ body: 'bad\x07bell' }).success).toBe(false);
  });

  it('rejects a body over 2000 characters', () => {
    expect(createCommentSchema.safeParse({ body: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('does not treat HTML as special (stored as plain text; output encoding is the client\'s job)', () => {
    const result = createCommentSchema.safeParse({ body: '<script>alert(1)</script>' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe('<script>alert(1)</script>');
  });
});
