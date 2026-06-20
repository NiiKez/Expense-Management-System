import { formatCurrency, formatCategory, formatDate, formatDateShort, formatFileSize } from '@/lib/format'

describe('format', () => {
  it('formats currency with cents preserved', () => {
    expect(formatCurrency(125.5, 'USD')).toBe('$125.50')
  })
  it('formats an ISO date as a long date', () => {
    expect(formatDate('2026-03-10')).toMatch(/March 10, 2026/)
  })
  it('formats file sizes', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB')
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
})
