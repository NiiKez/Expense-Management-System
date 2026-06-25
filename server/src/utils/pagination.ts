import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE, MAX_PAGE_SIZE } from './constants';
import { parsePositiveInteger } from './requestParsing';

type QueryValue = unknown;

export function parsePagination(query: {
  page?: QueryValue;
  pageSize?: QueryValue;
}): { page: number; pageSize: number } {
  const requestedPage = parsePositiveInteger(query.page, 'page') ?? DEFAULT_PAGE;
  const requestedPageSize = parsePositiveInteger(query.pageSize, 'pageSize') ?? DEFAULT_PAGE_SIZE;

  return {
    // Clamp page so an absurd value can't drive a massive SQL OFFSET.
    page: Math.min(requestedPage, MAX_PAGE),
    pageSize: Math.min(requestedPageSize, MAX_PAGE_SIZE),
  };
}
