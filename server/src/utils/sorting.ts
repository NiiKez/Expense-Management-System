import { badRequest } from './errors';
import { getSingleQueryValue } from './requestParsing';

export interface ResolvedSort {
  columnSql: string;
  direction: 'ASC' | 'DESC';
}

/**
 * Resolve a client-supplied (sort, order) pair into a safe ORDER BY fragment.
 *
 * `allowed` maps the public sort key (e.g. "amount") to a trusted SQL column
 * expression (e.g. "e.amount"). Only keys in the allowlist are accepted, so the
 * resolved `columnSql` is never attacker-controlled and is safe to interpolate.
 * Anything unrecognized is a 400 rather than a silent fallback.
 */
export function resolveSort(
  sortRaw: unknown,
  orderRaw: unknown,
  allowed: Record<string, string>,
  fallback: ResolvedSort,
): ResolvedSort {
  const sort = getSingleQueryValue(sortRaw, 'sort');
  const order = getSingleQueryValue(orderRaw, 'order');

  let columnSql = fallback.columnSql;
  if (sort !== undefined && sort !== '') {
    const mapped = allowed[sort];
    if (!mapped) {
      throw badRequest(`Invalid sort field. Allowed: ${Object.keys(allowed).join(', ')}`);
    }
    columnSql = mapped;
  }

  let direction = fallback.direction;
  if (order !== undefined && order !== '') {
    const normalized = order.toLowerCase();
    if (normalized !== 'asc' && normalized !== 'desc') {
      throw badRequest('Invalid sort order. Allowed: asc, desc');
    }
    direction = normalized === 'asc' ? 'ASC' : 'DESC';
  }

  return { columnSql, direction };
}
