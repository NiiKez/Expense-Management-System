import { updatePreferencesSchema } from '../../validations/userSchema';

describe('updatePreferencesSchema', () => {
  it('accepts a single notification flag', () => {
    const parsed = updatePreferencesSchema.parse({ notify_on_comment: false });
    expect(parsed).toEqual({ notify_on_comment: false });
  });

  it('uppercases and accepts a supported currency', () => {
    const parsed = updatePreferencesSchema.parse({ default_currency: 'eur' });
    expect(parsed.default_currency).toBe('EUR');
  });

  it('normalizes null and empty string to "no preference" (null)', () => {
    expect(updatePreferencesSchema.parse({ default_currency: null }).default_currency).toBeNull();
    expect(updatePreferencesSchema.parse({ default_currency: '' }).default_currency).toBeNull();
  });

  it('rejects an unsupported currency code', () => {
    expect(() => updatePreferencesSchema.parse({ default_currency: 'XYZ' })).toThrow();
  });

  it('rejects an empty body (must change at least one field)', () => {
    expect(() => updatePreferencesSchema.parse({})).toThrow();
  });

  it('rejects a non-boolean notification flag', () => {
    expect(() => updatePreferencesSchema.parse({ notify_on_decision: 'yes' })).toThrow();
  });
});
