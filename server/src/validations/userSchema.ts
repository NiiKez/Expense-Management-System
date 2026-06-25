import { z } from 'zod';
import { CURRENCY_CODES, isSupportedCurrency } from '../utils/constants';

// Default currency: a supported ISO 4217 code, or null to clear the preference
// (falls back to the org base currency). Empty string is treated as "clear".
const defaultCurrencySchema = z
  .union([z.string(), z.null()])
  .transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
  .refine(
    // Shared validator with the expense currency schema (isSupportedCurrency),
    // so the two can't drift. null/'' mean "clear the preference".
    (v) => v === null || v === '' || isSupportedCurrency(v),
    { message: `Default currency must be one of: ${CURRENCY_CODES.join(', ')}` },
  )
  .transform((v) => (v === '' ? null : v));

// PATCH semantics: every field optional, but the body must change something.
export const updatePreferencesSchema = z
  .object({
    default_currency: defaultCurrencySchema.optional(),
    notify_on_submission: z.boolean().optional(),
    notify_on_decision: z.boolean().optional(),
    notify_on_comment: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => Object.values(v).some((val) => val !== undefined),
    { message: 'Update body must contain at least one preference field' },
  );

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
