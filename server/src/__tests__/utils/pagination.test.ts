import { parsePagination } from '../../utils/pagination';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from '../../utils/constants';
import { AppError } from '../../utils/errors';

// parsePagination turns raw query values into a validated { page, pageSize }.
// It guards against non-integers, arrays, and oversized values so a crafted
// query can't drive a huge SQL OFFSET/LIMIT.

describe('parsePagination — defaults', () => {
  it('falls back to the defaults when both params are omitted', () => {
    expect(parsePagination({})).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('parses valid string integers', () => {
    expect(parsePagination({ page: '3', pageSize: '15' })).toEqual({
      page: 3,
      pageSize: 15,
    });
  });
});

describe('parsePagination — validation', () => {
  it.each([
    ['0', 'page'],
    ['-1', 'page'],
    ['abc', 'page'],
    ['1.5', 'page'],
    ['', 'page'],
  ])('rejects an invalid page value %s', (value) => {
    expect(() => parsePagination({ page: value })).toThrow(AppError);
  });

  // pageSize goes through the same parsePositiveInteger guard as page, so every
  // invalid-value case must reject on pageSize too — not only on page.
  it.each([
    ['0'],
    ['-1'],
    ['abc'],
    ['1.5'],
    [''],
  ])('rejects an invalid pageSize value %s', (value) => {
    expect(() => parsePagination({ pageSize: value })).toThrow(AppError);
  });

  it('rejects a page param provided more than once (array)', () => {
    expect(() => parsePagination({ page: ['1', '2'] })).toThrow(AppError);
  });

  it('rejects a pageSize param provided more than once (array)', () => {
    expect(() => parsePagination({ pageSize: ['10', '20'] })).toThrow(AppError);
  });

  it('rejects a non-string page param', () => {
    expect(() => parsePagination({ page: 5 as unknown as string })).toThrow(AppError);
  });

  it('rejects a non-string pageSize param', () => {
    expect(() => parsePagination({ pageSize: 5 as unknown as string })).toThrow(AppError);
  });
});

describe('parsePagination — upper bounds', () => {
  it('caps pageSize at MAX_PAGE_SIZE', () => {
    const { pageSize } = parsePagination({ pageSize: String(MAX_PAGE_SIZE + 50) });
    expect(pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('leaves a pageSize at exactly MAX_PAGE_SIZE unclamped', () => {
    const { pageSize } = parsePagination({ pageSize: String(MAX_PAGE_SIZE) });
    expect(pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('clamps an absurdly large page to MAX_PAGE (deep-pagination DoS guard)', () => {
    // Without a cap, a huge page yields a massive SQL OFFSET. It must clamp.
    const { page } = parsePagination({ page: '999999999' });
    expect(page).toBe(MAX_PAGE);
  });

  it('leaves a page at exactly MAX_PAGE untouched', () => {
    const { page } = parsePagination({ page: String(MAX_PAGE) });
    expect(page).toBe(MAX_PAGE);
  });

  it('does not clamp a page just below the cap', () => {
    const { page } = parsePagination({ page: String(MAX_PAGE - 1) });
    expect(page).toBe(MAX_PAGE - 1);
  });
});
