// Format a money amount in its own currency. Locale is left undefined so the
// runtime/browser locale drives grouping and decimal conventions while the
// currency code drives the symbol and minor-unit precision (e.g. JPY → no
// decimals). Previously this hardcoded 'en-US' regardless of currency.
//
// Crash-safety: amounts and currency codes come from the API and are trusted
// blindly by callers. A non-finite amount (formerly rendered "$NaN") returns a
// dash, and a malformed/empty currency code — which makes Intl.NumberFormat
// throw a RangeError and white-screen the whole row/page — falls back to a
// plain code + amount instead of crashing.
export const formatCurrency = (amount: number, currency = 'USD') => {
  // The API serialises DECIMAL columns as strings ("125.50"), so coerce before
  // the finiteness check — Number.isFinite('125.50') is false, but the value is valid.
  const value = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    const code = (currency ?? '').trim()
    return code ? `${code} ${value.toFixed(2)}` : value.toFixed(2)
  }
}

export const formatDate = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export const formatDateShort = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Turn an UPPER_SNAKE / UPPERCASE enum value into Title Case.
 * e.g. `TRAVEL` → `Travel`, `OFFICE_SUPPLIES` → `Office Supplies`.
 */
export const formatCategory = (value: string | null | undefined): string => {
  if (!value) return '—'
  return value
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Human-friendly relative time: "just now", "5 min ago", "3 hours ago",
 * "yesterday", "4 days ago". Beyond ~2 weeks it falls back to a short date.
 */
export const formatRelativeTime = (iso: string): string => {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso

  const diffMs = Date.now() - then
  const diffSec = Math.round(diffMs / 1000)

  // Future timestamps (clock skew) read as "just now".
  if (diffSec < 45) return 'just now'

  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`

  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`

  const diffDay = Math.round(diffHour / 24)
  if (diffDay === 1) return 'yesterday'
  if (diffDay <= 14) return `${diffDay} days ago`

  return formatDateShort(iso)
}
