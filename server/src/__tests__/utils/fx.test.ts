// Silence + spy on the logger so we can assert unknown currencies are warned
// without printing during the test run.
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import {
  BASE_CURRENCY,
  FX_RATES,
  convertToBase,
  amountInBaseSql,
  sumInBaseSql,
} from '../../utils/fx';
import logger from '../../config/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Constants ────────────────────────────────────────────────────

describe('FX constants', () => {
  it('uses USD as the base currency', () => {
    expect(BASE_CURRENCY).toBe('USD');
  });

  it('treats the base currency as a 1:1 rate', () => {
    expect(FX_RATES[BASE_CURRENCY]).toBe(1);
  });

  it('exposes the expected static rate table', () => {
    expect(FX_RATES).toEqual({
      USD: 1,
      EUR: 1.08,
      GBP: 1.27,
      CAD: 0.73,
      AUD: 0.66,
      JPY: 0.0067,
    });
  });
});

// ── convertToBase ────────────────────────────────────────────────

describe('convertToBase', () => {
  it('returns the amount unchanged for the base currency (rate 1)', () => {
    expect(convertToBase(100, 'USD')).toBe(100);
    expect(convertToBase(0.55, 'USD')).toBe(0.55);
  });

  // Exact numeric expectations for every known non-base currency.
  it.each([
    ['EUR', 100, 108], // 100 * 1.08
    ['GBP', 100, 127], // 100 * 1.27
    ['CAD', 100, 73], // 100 * 0.73
    ['AUD', 100, 66], // 100 * 0.66
    ['JPY', 1000, 6.7], // 1000 * 0.0067
  ])('converts %s to base with the correct rate', (currency, amount, expected) => {
    expect(convertToBase(amount, currency)).toBe(expected);
  });

  // ── Rounding ──────────────────────────────────────────────────

  it('rounds to 2 decimal places (Math.round on cents)', () => {
    // 10 * 1.27 = 12.7 -> exact, but 10.005-style products need rounding.
    // 33.33 * 1.08 = 35.9964 -> rounds to 35.99 (banker's-free Math.round on 35.9964*100=3599.64 -> 3600? no: 3599.64 rounds to 3600 -> 36.00)
    // Use a value with a clear >2-decimal product:
    // 7.77 * 1.27 = 9.8679 -> *100 = 986.79 -> round 987 -> 9.87
    expect(convertToBase(7.77, 'GBP')).toBe(9.87);
  });

  it('rounds half up via Math.round (clean half value)', () => {
    // 2.5 * 1 (USD) -> 2.5*100 = 250 -> exact; pick a value whose cents land
    // exactly on .5 in IEEE-754 to document half-up rounding.
    // 0.125 * 1.08 = 0.135 -> *100 = 13.5 (representable) -> Math.round 14 -> 0.14
    expect(convertToBase(0.125, 'EUR')).toBe(0.14);
  });

  it('rounds 1.005 up to 1.01 via the epsilon nudge (IEEE-754 half-cent fix)', () => {
    // 1.005 is stored as ~1.00499999999999989, so a naive 1.005 * 100 = 100.4999...
    // would Math.round down to 100 -> 1.00. Adding Number.EPSILON before scaling
    // nudges it past the half-cent boundary so it rounds to the intended 1.01.
    expect(convertToBase(1.005, 'USD')).toBe(1.01);
  });

  it('rounds a JPY conversion that produces many decimals', () => {
    // 12345 * 0.0067 = 82.7115 -> *100 = 8271.15 -> round 8271 -> 82.71
    expect(convertToBase(12345, 'JPY')).toBe(82.71);
  });

  it('does not introduce floating-point noise beyond 2 decimals', () => {
    const result = convertToBase(19.99, 'EUR'); // 19.99 * 1.08 = 21.5892 -> 21.59
    expect(result).toBe(21.59);
    // Guard against e.g. 21.589999999999996 leaking through.
    expect(Number.isInteger(result * 100)).toBe(true);
  });

  // ── Case-insensitivity ────────────────────────────────────────

  it('is case-insensitive for the currency code', () => {
    expect(convertToBase(100, 'eur')).toBe(108);
    expect(convertToBase(100, 'Eur')).toBe(108);
    expect(convertToBase(100, 'eUr')).toBe(108);
    expect(convertToBase(100, 'EUR')).toBe(108);
  });

  // ── Unknown / missing currency fallback ───────────────────────

  it('treats an unknown currency as 1:1 (no throw) and warns it was unrecognized', () => {
    let result: number | undefined;
    expect(() => {
      result = convertToBase(100, 'XYZ');
    }).not.toThrow();
    expect(result).toBe(100);
    // An unrecognized but non-empty code is summed at face value, which would
    // skew aggregate totals — so it is logged at warn level for visibility.
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('XYZ'),
      expect.objectContaining({ currency: 'XYZ' }),
    );
  });

  it('treats an empty currency string as 1:1 WITHOUT warning (no code supplied)', () => {
    expect(convertToBase(100, '')).toBe(100);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  it('treats a null/undefined currency as 1:1 WITHOUT warning (optional-chaining guard)', () => {
    // currency?.toUpperCase() yields undefined; FX_RATES[''] ?? 1 -> 1. A missing
    // currency is the legitimate "no preference" case, so it must not log noise.
    expect(convertToBase(100, undefined as unknown as string)).toBe(100);
    expect(convertToBase(100, null as unknown as string)).toBe(100);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  // ── Edge-case amounts ─────────────────────────────────────────

  it('returns 0 for a zero amount', () => {
    expect(convertToBase(0, 'EUR')).toBe(0);
    expect(convertToBase(0, 'USD')).toBe(0);
    expect(convertToBase(0, 'XYZ')).toBe(0);
  });

  it('converts negative amounts (refunds/adjustments) preserving sign', () => {
    expect(convertToBase(-100, 'EUR')).toBe(-108);
    // Rounding of a negative product: -7.77 * 1.27 = -9.8679 -> *100 = -986.79
    // Math.round(-986.79) = -987 -> -9.87
    expect(convertToBase(-7.77, 'GBP')).toBe(-9.87);
  });
});

// ── amountInBaseSql ──────────────────────────────────────────────

describe('amountInBaseSql', () => {
  it('produces a well-formed multiplicative CASE expression', () => {
    const sql = amountInBaseSql('amount');
    expect(sql).toBe(
      "(amount * CASE currency WHEN 'EUR' THEN 1.08 WHEN 'GBP' THEN 1.27 " +
        "WHEN 'CAD' THEN 0.73 WHEN 'AUD' THEN 0.66 WHEN 'JPY' THEN 0.0067 ELSE 1 END)"
    );
  });

  it('wraps the whole expression in parentheses', () => {
    const sql = amountInBaseSql('amount');
    expect(sql.startsWith('(')).toBe(true);
    expect(sql.endsWith(')')).toBe(true);
  });

  it('multiplies the provided amount column inside the parens', () => {
    expect(amountInBaseSql('e.amount')).toContain('(e.amount * CASE currency');
  });

  it('uses "currency" as the default currency column', () => {
    expect(amountInBaseSql('amount')).toContain('CASE currency ');
  });

  it('honors a custom currency column name', () => {
    const sql = amountInBaseSql('e.amount', 'e.currency');
    expect(sql).toContain('CASE e.currency ');
    expect(sql).not.toContain('CASE currency ');
  });

  it('emits a WHEN branch only for currencies whose rate differs from 1', () => {
    const sql = amountInBaseSql('amount');
    // Base (USD, rate 1) is collapsed into the ELSE, not a WHEN branch.
    expect(sql).not.toContain("WHEN 'USD'");
    expect(sql).toContain("WHEN 'EUR' THEN 1.08");
    expect(sql).toContain("WHEN 'GBP' THEN 1.27");
    expect(sql).toContain("WHEN 'CAD' THEN 0.73");
    expect(sql).toContain("WHEN 'AUD' THEN 0.66");
    expect(sql).toContain("WHEN 'JPY' THEN 0.0067");
  });

  it('falls back to a 1:1 multiplier via ELSE', () => {
    expect(amountInBaseSql('amount')).toContain('ELSE 1 END');
  });

  it('emits exactly one WHEN branch per non-base currency', () => {
    const sql = amountInBaseSql('amount');
    const whenCount = (sql.match(/WHEN /g) ?? []).length;
    const nonBaseCount = Object.values(FX_RATES).filter((r) => r !== 1).length;
    expect(whenCount).toBe(nonBaseCount);
    expect(whenCount).toBe(5);
  });
});

// ── sumInBaseSql ─────────────────────────────────────────────────

describe('sumInBaseSql', () => {
  it('wraps the base conversion in ROUND(SUM(...), 2)', () => {
    const sql = sumInBaseSql('amount');
    expect(sql).toBe(`ROUND(SUM(${amountInBaseSql('amount')}), 2)`);
  });

  it('rounds the summed total to 2 decimals', () => {
    const sql = sumInBaseSql('amount');
    expect(sql.startsWith('ROUND(SUM(')).toBe(true);
    expect(sql.endsWith('), 2)')).toBe(true);
  });

  it('embeds the full CASE conversion inside the SUM', () => {
    const sql = sumInBaseSql('amount');
    expect(sql).toContain("WHEN 'EUR' THEN 1.08");
    expect(sql).toContain('ELSE 1 END');
  });

  it('forwards a custom currency column to the inner conversion', () => {
    const sql = sumInBaseSql('e.amount', 'e.currency');
    expect(sql).toContain('CASE e.currency ');
    expect(sql).toBe(`ROUND(SUM(${amountInBaseSql('e.amount', 'e.currency')}), 2)`);
  });
});
