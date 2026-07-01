// ============================================================
// Currency normalization
// ============================================================
// The org reports all aggregate totals (dashboard stats, charts) in a single
// BASE_CURRENCY. Individual expenses keep their own currency; only *sums* are
// normalized, because adding amounts across currencies is otherwise meaningless.
//
// Rates are static and approximate — there is no live FX provider wired in.
// They are app-controlled constants (never user input), so it is safe to inline
// them into SQL CASE expressions. A currency not listed here (or the base
// itself) is treated as a 1:1 multiplier, i.e. summed at face value.

import logger from '../config/logger';

export const BASE_CURRENCY = 'USD';

// Units of BASE_CURRENCY per 1 unit of the given currency.
export const FX_RATES: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.66,
  JPY: 0.0067,
};

/**
 * Convert a single amount to the base currency in JS. Unknown currencies pass
 * through unchanged (treated as already base).
 */
export function convertToBase(amount: number, currency: string): number {
  const code = currency?.toUpperCase() ?? '';
  const rate = FX_RATES[code];
  if (rate === undefined && code !== '') {
    // Unknown code: we sum at face value (rate 1), which can skew aggregate
    // totals. Log it so the bad code is visible rather than silently absorbed.
    logger.warn(`convertToBase: unknown currency code "${code}", summing at face value`, {
      currency: code,
    });
  }
  // Round half AWAY FROM ZERO at cent precision. We round the *magnitude* with a
  // tiny cent-scale nudge — so a half-cent stored just below its decimal (float
  // error, e.g. 1.005 -> 1.00499999...) still rounds up — then reapply the sign.
  // Doing it on the magnitude keeps refunds/negative adjustments symmetric with
  // their positive mirror (-1.005 -> -1.01, matching +1.005 -> 1.01) and aligns
  // with MySQL ROUND()'s half-away-from-zero semantics used by sumInBaseSql.
  const scaled = amount * (rate ?? 1);
  const cents = Math.round(Math.abs(scaled) * 100 + 1e-9);
  const result = (Math.sign(scaled) * cents) / 100;
  return result === 0 ? 0 : result; // normalize -0 to 0
}

/**
 * Build a SQL expression that converts `amountCol` (in `currencyCol`'s currency)
 * into the base currency. Only currencies whose rate differs from 1 need a
 * branch; everything else falls through the ELSE as a 1:1 multiplier.
 *
 * Values interpolated here are the static constants above — not user input.
 */
export function amountInBaseSql(amountCol: string, currencyCol = 'currency'): string {
  const branches = Object.entries(FX_RATES)
    .filter(([, rate]) => rate !== 1)
    .map(([code, rate]) => `WHEN '${code}' THEN ${rate}`)
    .join(' ');

  return `(${amountCol} * CASE ${currencyCol} ${branches} ELSE 1 END)`;
}

/**
 * Wrap a money column in the base-currency conversion and SUM+ROUND it.
 * Returns a SQL fragment like `ROUND(SUM((amount * CASE ...)), 2)`.
 */
export function sumInBaseSql(amountCol: string, currencyCol = 'currency'): string {
  return `ROUND(SUM(${amountInBaseSql(amountCol, currencyCol)}), 2)`;
}
