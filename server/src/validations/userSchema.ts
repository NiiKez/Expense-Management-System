import { z } from 'zod';
import { CURRENCY_CODES } from '../utils/constants';

// Default currency: a supported ISO 4217 code, or null to clear the preference
// (falls back to the org base currency). Empty string is treated as "clear".
const defaultCurrencySchema = z
  .union([z.string(), z.null()])
  .transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
  .refine(
    (v) => v === null || v === '' || (CURRENCY_CODES as readonly string[]).includes(v),
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
  .refine(
    (v) => Object.values(v).some((val) => val !== undefined),
    { message: 'Update body must contain at least one preference field' },
  );

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
