import { badRequest } from './errors';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants';

type QueryValue = unknown;

function parsePositiveInteger(value: QueryValue, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw badRequest(`${field} must be provided only once`);
  }

  if (typeof value !== 'string') {
    throw badRequest(`${field} must be a positive integer`);
  }

  if (!/^\d+$/.test(value)) {
    throw badRequest(`${field} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw badRequest(`${field} must be a positive integer`);
  }

  return parsed;
}

export function parsePagination(query: {
  page?: QueryValue;
  pageSize?: QueryValue;
}): { page: number; pageSize: number } {
  const page = parsePositiveInteger(query.page, 'page') ?? DEFAULT_PAGE;
  const requestedPageSize = parsePositiveInteger(query.pageSize, 'pageSize') ?? DEFAULT_PAGE_SIZE;

  return {
    page,
    pageSize: Math.min(requestedPageSize, MAX_PAGE_SIZE),
  };
}
