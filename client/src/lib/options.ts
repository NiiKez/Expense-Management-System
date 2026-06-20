import { Category, Status } from '@/types'

export const CATEGORY_OPTIONS = Object.values(Category)
export const STATUS_OPTIONS = Object.values(Status)

// Currencies offered in the expense form's currency select.
export const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'] as const
