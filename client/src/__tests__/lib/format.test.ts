import {
  formatCurrency,
  formatCategory,
  formatDate,
  formatDateShort,
  formatFileSize,
  formatRelativeTime,
} from '@/lib/format'

describe('format', () => {
  it('formats currency with cents preserved', () => {
    expect(formatCurrency(125.5, 'USD')).toBe('$125.50')
  })
  it('formats an ISO date as a long date', () => {
    expect(formatDate('2026-03-10')).toMatch(/March 10, 2026/)
  })
  it('formats file sizes across the B / KB / MB branches', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('formats a valid ISO date as a short date', () => {
    expect(formatDateShort('2026-03-10')).toMatch(/Mar 10, 2026/)
  })

  describe('crash-safety', () => {
    it('does not throw on an invalid currency code, falling back to code + amount', () => {
      // Intl.NumberFormat throws a RangeError on a malformed currency code.
      expect(() => formatCurrency(125.5, 'BADCODE')).not.toThrow()
      expect(formatCurrency(125.5, 'BADCODE')).toBe('BADCODE 125.50')
    })
    it('falls back to a bare amount when the currency code is empty', () => {
      expect(() => formatCurrency(125.5, '')).not.toThrow()
      expect(formatCurrency(125.5, '')).toBe('125.50')
    })
    it('returns a dash for a non-finite amount instead of "$NaN"', () => {
      expect(formatCurrency(Number.NaN, 'USD')).toBe('—')
    })
    it('coerces a numeric string amount (the API returns DECIMAL as a string)', () => {
      // The API serialises DECIMAL(10,2) columns as strings like "125.50".
      expect(formatCurrency('125.50' as unknown as number, 'USD')).toBe('$125.50')
    })
    it('returns a dash for a non-numeric string amount', () => {
      expect(formatCurrency('abc' as unknown as number, 'USD')).toBe('—')
    })
    it('returns a dash for an unparseable date instead of "Invalid Date"', () => {
      expect(formatDate('not-a-date')).toBe('—')
      expect(formatDate('')).toBe('—')
    })
    it('returns a dash for an unparseable short date', () => {
      expect(formatDateShort('not-a-date')).toBe('—')
    })
    it('returns a dash for a null/empty category instead of throwing', () => {
      expect(() => formatCategory(null as unknown as string)).not.toThrow()
      expect(formatCategory(null as unknown as string)).toBe('—')
      expect(formatCategory('')).toBe('—')
    })
    it('still title-cases a valid category', () => {
      expect(formatCategory('OFFICE_SUPPLIES')).toBe('Office Supplies')
    })
  })

  describe('formatRelativeTime', () => {
    // A fixed "now" so every branch is deterministic. formatRelativeTime reads
    // Date.now() for the delta; spying only the static leaves `new Date(iso)`
    // (which parses the argument) untouched — exactly what we want.
    const ANCHOR = Date.UTC(2026, 6, 1, 12, 0, 0) // 2026-07-01T12:00:00Z
    const ago = (ms: number) => new Date(ANCHOR - ms).toISOString()
    const SEC = 1000
    const MIN = 60 * SEC
    const HOUR = 60 * MIN
    const DAY = 24 * HOUR

    beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(ANCHOR))
    afterEach(() => jest.restoreAllMocks())

    it('reads a fresh timestamp as "just now"', () => {
      expect(formatRelativeTime(ago(10 * SEC))).toBe('just now')
    })
    it('reads a future timestamp (clock skew) as "just now"', () => {
      expect(formatRelativeTime(new Date(ANCHOR + MIN).toISOString())).toBe('just now')
    })
    it('reports minutes', () => {
      expect(formatRelativeTime(ago(5 * MIN))).toBe('5 min ago')
    })
    it('reports a singular hour', () => {
      expect(formatRelativeTime(ago(1 * HOUR))).toBe('1 hour ago')
    })
    it('reports plural hours', () => {
      expect(formatRelativeTime(ago(3 * HOUR))).toBe('3 hours ago')
    })
    it('reports "yesterday" at one day', () => {
      expect(formatRelativeTime(ago(1 * DAY))).toBe('yesterday')
    })
    it('reports days within the two-week window', () => {
      expect(formatRelativeTime(ago(4 * DAY))).toBe('4 days ago')
    })
    it('falls back to a short date beyond two weeks', () => {
      expect(formatRelativeTime(ago(30 * DAY))).toMatch(/Jun 1, 2026/)
    })
    it('returns the raw input for an unparseable timestamp', () => {
      expect(formatRelativeTime('not-a-date')).toBe('not-a-date')
    })
  })
})
