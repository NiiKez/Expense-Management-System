import { Category, Status } from '@/types'

export const CATEGORY_OPTIONS = Object.values(Category)
export const STATUS_OPTIONS = Object.values(Status)

// Currencies offered in the expense form's currency select.
export const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'] as const
export type CurrencyCode = (typeof CURRENCY_OPTIONS)[number]

// Single source of truth for "is this a currency we support". Case-insensitive
// so it can validate raw user/server input before it's normalised to uppercase.
export function isSupportedCurrency(code: string): boolean {
  return (CURRENCY_OPTIONS as readonly string[]).includes(code.toUpperCase())
}
