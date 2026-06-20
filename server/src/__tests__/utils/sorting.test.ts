import { resolveSort, ResolvedSort } from '@/utils/sorting';
import { AppError } from '@/utils/errors';

// Mirror of the real allowlists used by callers (server/src/models/expense.ts
// and server/src/models/auditLog.ts) so the tests exercise realistic shapes.
const USER_EXPENSE_SORTS: Record<string, string> = {
  title: 'title',
  category: 'category',
  amount: 'amount',
  date: 'expense_date',
  status: 'status',
  created: 'created_at',
};

const ADMIN_EXPENSE_SORTS: Record<string, string> = {
  title: 'e.title',
  submitter: 'u.display_name',
  category: 'e.category',
  amount: 'e.amount',
  date: 'e.expense_date',
  status: 'e.status',
  created: 'e.created_at',
};

const FALLBACK: ResolvedSort = { columnSql: 'created_at', direction: 'DESC' };

describe('resolveSort', () => {
  // ── Allowed sort keys map to the trusted column SQL ──────────────

  describe('allowed sort keys', () => {
    it.each(Object.entries(USER_EXPENSE_SORTS))(
      'maps user-expense key "%s" to column "%s"',
      (key, expectedColumn) => {
        const result = resolveSort(key, 'asc', USER_EXPENSE_SORTS, FALLBACK);
        expect(result.columnSql).toBe(expectedColumn);
      },
    );

    it.each(Object.entries(ADMIN_EXPENSE_SORTS))(
      'maps admin-expense key "%s" to table-qualified column "%s"',
      (key, expectedColumn) => {
        const result = resolveSort(key, 'asc', ADMIN_EXPENSE_SORTS, FALLBACK);
        expect(result.columnSql).toBe(expectedColumn);
      },
    );

    it('resolves the full pair (column + direction) together', () => {
      const result = resolveSort('amount', 'desc', USER_EXPENSE_SORTS, FALLBACK);
      expect(result).toEqual({ columnSql: 'amount', direction: 'DESC' });
    });

    it('only ever returns a column from the allowlist (never the raw key)', () => {
      const result = resolveSort('date', 'asc', USER_EXPENSE_SORTS, FALLBACK);
      // requested key is "date" but trusted column is "expense_date"
      expect(result.columnSql).toBe('expense_date');
      expect(result.columnSql).not.toBe('date');
    });
  });

  // ── Direction handling ───────────────────────────────────────────

  describe('direction handling', () => {
    it('maps order "asc" to ASC', () => {
      expect(resolveSort('amount', 'asc', USER_EXPENSE_SORTS, FALLBACK).direction).toBe('ASC');
    });

    it('maps order "desc" to DESC', () => {
      expect(resolveSort('amount', 'desc', USER_EXPENSE_SORTS, FALLBACK).direction).toBe('DESC');
    });

    it.each(['ASC', 'Asc', 'aSc'])('accepts case-insensitive order "%s" as ASC', (order) => {
      expect(resolveSort('amount', order, USER_EXPENSE_SORTS, FALLBACK).direction).toBe('ASC');
    });

    it.each(['DESC', 'Desc', 'dEsC'])('accepts case-insensitive order "%s" as DESC', (order) => {
      expect(resolveSort('amount', order, USER_EXPENSE_SORTS, FALLBACK).direction).toBe('DESC');
    });

    it('uses fallback direction when order is undefined', () => {
      expect(resolveSort('amount', undefined, USER_EXPENSE_SORTS, FALLBACK).direction).toBe('DESC');
    });

    it('uses fallback direction when order is an empty string', () => {
      expect(resolveSort('amount', '', USER_EXPENSE_SORTS, FALLBACK).direction).toBe('DESC');
    });

    it('honours an ASC fallback direction', () => {
      const ascFallback: ResolvedSort = { columnSql: 'created_at', direction: 'ASC' };
      expect(resolveSort(undefined, undefined, USER_EXPENSE_SORTS, ascFallback).direction).toBe(
        'ASC',
      );
    });
  });

  // ── Missing / empty sort params fall back safely ──────────────────

  describe('missing or empty sort params', () => {
    it('returns the full fallback when both sort and order are undefined', () => {
      expect(resolveSort(undefined, undefined, USER_EXPENSE_SORTS, FALLBACK)).toEqual(FALLBACK);
    });

    it('uses the fallback column when sort is undefined', () => {
      expect(resolveSort(undefined, 'asc', USER_EXPENSE_SORTS, FALLBACK).columnSql).toBe(
        'created_at',
      );
    });

    it('uses the fallback column when sort is an empty string', () => {
      const result = resolveSort('', 'asc', USER_EXPENSE_SORTS, FALLBACK);
      expect(result.columnSql).toBe('created_at');
      expect(result.direction).toBe('ASC');
    });
  });

  // ── SECURITY: SQL-injection allowlist gate ────────────────────────

  describe('SQL-injection guard (disallowed sort keys)', () => {
    const injectionAttempts = [
      'amount; DROP TABLE users',
      'amount; DROP TABLE users; --',
      '(SELECT password FROM users)',
      "1; DELETE FROM expenses WHERE '1'='1",
      'amount UNION SELECT * FROM users',
      'evil',
      'AMOUNT', // wrong case — allowlist is case-sensitive on the key
      'amount ', // trailing space — not an exact allowlist match
      ' amount', // leading space
    ];

    it.each(injectionAttempts)('rejects unknown/malicious sort key %p with a 400 AppError', (evil) => {
      expect(() => resolveSort(evil, 'asc', USER_EXPENSE_SORTS, FALLBACK)).toThrow(AppError);

      try {
        resolveSort(evil, 'asc', USER_EXPENSE_SORTS, FALLBACK);
        throw new Error('expected resolveSort to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).message).toContain('Invalid sort field');
      }
    });

    it('never falls back silently for a bad key — it must throw', () => {
      // A silent fallback would be a security smell; assert the throw explicitly.
      expect(() => resolveSort('evil', undefined, USER_EXPENSE_SORTS, FALLBACK)).toThrow(
        /Invalid sort field/,
      );
    });

    it('lists the allowed keys in the error message', () => {
      try {
        resolveSort('evil', 'asc', USER_EXPENSE_SORTS, FALLBACK);
        throw new Error('expected resolveSort to throw');
      } catch (err) {
        const message = (err as AppError).message;
        for (const key of Object.keys(USER_EXPENSE_SORTS)) {
          expect(message).toContain(key);
        }
      }
    });

    // KNOWN GAP (documented, not fixed here — source is out of scope):
    // resolveSort uses `allowed[sort]`, a plain bracket access that walks the
    // prototype chain. Keys that name Object.prototype members (e.g.
    // "__proto__", "constructor", "toString", "hasOwnProperty") therefore
    // resolve to a truthy function/object and slip past the `if (!mapped)`
    // guard instead of producing a 400. These are NOT exploitable SQL strings
    // (columnSql becomes a function reference, which would break the query
    // rather than inject), but they do violate the "anything unrecognized is a
    // 400" contract. A hardened version should use
    // `Object.prototype.hasOwnProperty.call(allowed, sort)`.
    // The tests below pin the CURRENT behavior so a future fix surfaces here.
    it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
      'CURRENT BEHAVIOR: prototype-chain key %p is not rejected (does not throw)',
      (protoKey) => {
        expect(() => resolveSort(protoKey, 'asc', USER_EXPENSE_SORTS, FALLBACK)).not.toThrow();
        const result = resolveSort(protoKey, 'asc', USER_EXPENSE_SORTS, FALLBACK);
        // It resolves to a non-string (inherited member), not a clean column.
        expect(typeof result.columnSql).not.toBe('string');
      },
    );
  });

  // ── Invalid direction is rejected ─────────────────────────────────

  describe('invalid sort order', () => {
    const badOrders = ['ascending', 'descending', 'up', 'asc; DROP TABLE users', 'DESC--', 'rand()'];

    it.each(badOrders)('rejects invalid order %p with a 400 AppError', (order) => {
      expect(() => resolveSort('amount', order, USER_EXPENSE_SORTS, FALLBACK)).toThrow(AppError);

      try {
        resolveSort('amount', order, USER_EXPENSE_SORTS, FALLBACK);
        throw new Error('expected resolveSort to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).message).toContain('Invalid sort order');
      }
    });

    it('validates sort before falling back on order (bad sort throws even with bad order)', () => {
      expect(() => resolveSort('evil', 'bogus', USER_EXPENSE_SORTS, FALLBACK)).toThrow(
        /Invalid sort field/,
      );
    });
  });

  // ── Malformed param types (delegated to getSingleQueryValue) ──────

  describe('malformed query value types', () => {
    it('rejects an array sort param (provided more than once)', () => {
      expect(() => resolveSort(['amount', 'title'], 'asc', USER_EXPENSE_SORTS, FALLBACK)).toThrow(
        AppError,
      );
      expect(() =>
        resolveSort(['amount', 'title'], 'asc', USER_EXPENSE_SORTS, FALLBACK),
      ).toThrow(/sort must be provided only once/);
    });

    it('rejects an array order param', () => {
      expect(() =>
        resolveSort('amount', ['asc', 'desc'], USER_EXPENSE_SORTS, FALLBACK),
      ).toThrow(/order must be provided only once/);
    });

    it('rejects a non-string sort param (object)', () => {
      expect(() => resolveSort({ evil: true }, 'asc', USER_EXPENSE_SORTS, FALLBACK)).toThrow(
        /sort must be a string/,
      );
    });

    it('rejects a numeric sort param', () => {
      expect(() => resolveSort(123, 'asc', USER_EXPENSE_SORTS, FALLBACK)).toThrow(
        /sort must be a string/,
      );
    });
  });

  // ── Output shape integrity ────────────────────────────────────────

  it('returns exactly { columnSql, direction } with an uppercase direction', () => {
    const result = resolveSort('title', 'asc', ADMIN_EXPENSE_SORTS, FALLBACK);
    expect(Object.keys(result).sort()).toEqual(['columnSql', 'direction']);
    expect(['ASC', 'DESC']).toContain(result.direction);
  });
});
