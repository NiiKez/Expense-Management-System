import { CURRENCY_OPTIONS, isSupportedCurrency } from '@/lib/options'

describe('isSupportedCurrency', () => {
  it('accepts every offered currency option', () => {
    for (const code of CURRENCY_OPTIONS) {
      expect(isSupportedCurrency(code)).toBe(true)
    }
  })

  it('is case-insensitive', () => {
    expect(isSupportedCurrency('usd')).toBe(true)
    expect(isSupportedCurrency('eur')).toBe(true)
  })

  it('rejects well-formed but unsupported 3-letter codes', () => {
    expect(isSupportedCurrency('XYZ')).toBe(false)
    expect(isSupportedCurrency('ZZZ')).toBe(false)
    expect(isSupportedCurrency('CHF')).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(isSupportedCurrency('')).toBe(false)
    expect(isSupportedCurrency('US')).toBe(false)
    expect(isSupportedCurrency('US$')).toBe(false)
  })
})
