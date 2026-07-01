import {
  parsePositiveId,
  parseEnumQuery,
  parseStringQuery,
  parseDateQuery,
  isStrictDate,
} from '../../utils/requestParsing';
import { AppError } from '../../utils/errors';

// requestParsing holds the parsers that gate every raw query/route value before
// it reaches SQL across the controllers. They must reject anything that isn't the
// exact expected shape with an operational 400 (AppError), never coerce loosely.

// Assert the callback throws an AppError carrying HTTP 400 (badRequest).
function expectBadRequest(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).statusCode).toBe(400);
}

describe('parsePositiveId', () => {
  // Every one of these must be rejected: they either fail the /^\d+$/ shape or
  // survive it but aren't a safe positive integer.
  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['decimal', '1.5'],
    ['non-numeric', 'abc'],
    ['scientific notation', '1e3'],
    ['leading space', ' 5'],
    ['trailing space', '5 '],
    ['empty string', ''],
    ['20-digit unsafe integer', '12345678901234567890'],
    ['hex-ish', '0x10'],
  ])('throws AppError(400) for %s', (_label, value) => {
    expectBadRequest(() => parsePositiveId(value, 'id'));
  });

  // Non-string inputs never pass the typeof guard.
  it.each([
    ['array of digit strings', ['1', '2']],
    ['single-element array', ['1']],
    ['number', 42],
    ['boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
  ])('throws AppError(400) for a non-string: %s', (_label, value) => {
    expectBadRequest(() => parsePositiveId(value as unknown as string, 'id'));
  });

  it('returns the number for a valid positive integer string', () => {
    expect(parsePositiveId('42', 'id')).toBe(42);
    expect(parsePositiveId('1', 'id')).toBe(1);
  });

  it('accepts the largest safe integer boundary', () => {
    expect(parsePositiveId(String(Number.MAX_SAFE_INTEGER), 'id')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('parseEnumQuery', () => {
  const allowed = ['PENDING', 'APPROVED', 'REJECTED'] as const;

  it('returns a member of the allowlist unchanged', () => {
    expect(parseEnumQuery('APPROVED', 'status', allowed)).toBe('APPROVED');
    expect(parseEnumQuery('PENDING', 'status', allowed)).toBe('PENDING');
  });

  it('throws AppError(400) for a value outside the allowlist', () => {
    expectBadRequest(() => parseEnumQuery('DELETED', 'status', allowed));
  });

  it('is case-sensitive (a differently-cased member is rejected)', () => {
    expectBadRequest(() => parseEnumQuery('approved', 'status', allowed));
  });

  it('returns undefined when the value is absent (undefined)', () => {
    expect(parseEnumQuery(undefined, 'status', allowed)).toBeUndefined();
  });

  it('throws AppError(400) for a repeated (array) value', () => {
    expectBadRequest(() => parseEnumQuery(['APPROVED', 'PENDING'], 'status', allowed));
  });

  it('throws AppError(400) for a non-string value', () => {
    expectBadRequest(() => parseEnumQuery(1 as unknown as string, 'status', allowed));
  });
});

describe('parseStringQuery', () => {
  it('enforces maxLength: 100 chars passes, 101 throws', () => {
    expect(parseStringQuery('x'.repeat(100), 'search', { maxLength: 100 })).toBe('x'.repeat(100));
    expectBadRequest(() => parseStringQuery('x'.repeat(101), 'search', { maxLength: 100 }));
  });

  it('trims surrounding whitespace by default', () => {
    expect(parseStringQuery('  hello  ', 'search')).toBe('hello');
  });

  it('measures length after trimming (a padded 100-char value passes maxLength 100)', () => {
    expect(parseStringQuery(`  ${'x'.repeat(100)}  `, 'search', { maxLength: 100 })).toBe('x'.repeat(100));
  });

  it('does not trim when trim:false', () => {
    expect(parseStringQuery('  hello  ', 'search', { trim: false })).toBe('  hello  ');
  });

  it('returns undefined for an empty string', () => {
    expect(parseStringQuery('', 'search')).toBeUndefined();
  });

  it('returns undefined for a whitespace-only string (trims to empty)', () => {
    expect(parseStringQuery('   ', 'search')).toBeUndefined();
  });

  it('returns undefined when the value is absent (undefined)', () => {
    expect(parseStringQuery(undefined, 'search')).toBeUndefined();
  });

  it('throws AppError(400) for a repeated (array) value', () => {
    expectBadRequest(() => parseStringQuery(['a', 'b'], 'search'));
  });
});

describe('parseDateQuery', () => {
  it.each([
    ['month out of range', '2026-13-01'],
    ['day out of range for month', '2026-02-30'],
    ['US slash format', '06/15/2026'],
    ['non-zero-padded parts', '2026-1-1'],
    ['not a date', 'nope'],
  ])('throws AppError(400) for %s', (_label, value) => {
    expectBadRequest(() => parseDateQuery(value, 'from'));
  });

  it('returns a valid ISO date string unchanged', () => {
    expect(parseDateQuery('2026-06-15', 'from')).toBe('2026-06-15');
  });

  it('returns undefined when the value is absent (undefined)', () => {
    expect(parseDateQuery(undefined, 'from')).toBeUndefined();
  });

  it('throws AppError(400) for a repeated (array) value', () => {
    expectBadRequest(() => parseDateQuery(['2026-06-15', '2026-06-16'], 'from'));
  });
});

describe('isStrictDate', () => {
  it.each([
    ['a real date', '2026-06-15'],
    ['a leap day in a leap year', '2024-02-29'],
  ])('accepts %s', (_label, value) => {
    expect(isStrictDate(value)).toBe(true);
  });

  it.each([
    ['month 13', '2026-13-01'],
    ['Feb 30', '2026-02-30'],
    ['a leap day in a NON-leap year', '2026-02-29'],
    ['wrong separator/format', '06/15/2026'],
    ['non-zero-padded', '2026-1-1'],
    ['garbage', 'not-a-date'],
  ])('rejects %s', (_label, value) => {
    expect(isStrictDate(value)).toBe(false);
  });
});
