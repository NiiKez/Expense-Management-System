import { badRequest } from './errors';

export function getSingleQueryValue(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;

  if (Array.isArray(value)) {
    throw badRequest(`${field} must be provided only once`);
  }

  if (typeof value !== 'string') {
    throw badRequest(`${field} must be a string`);
  }

  return value;
}

export function parsePositiveInteger(value: unknown, field: string): number | undefined {
  const raw = getSingleQueryValue(value, field);
  if (raw === undefined) return undefined;

  if (!/^\d+$/.test(raw)) {
    throw badRequest(`${field} must be a positive integer`);
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw badRequest(`${field} must be a positive integer`);
  }

  return parsed;
}

export function parsePositiveId(value: unknown, field: string): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw badRequest(`Invalid ${field}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw badRequest(`Invalid ${field}`);
  }

  return parsed;
}

export function parseEnumQuery<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowedValues: T,
): T[number] | undefined {
  const raw = getSingleQueryValue(value, field);
  if (raw === undefined) return undefined;

  if (!allowedValues.includes(raw)) {
    throw badRequest(`Invalid ${field}. Must be one of: ${allowedValues.join(', ')}`);
  }

  return raw;
}

export function parseStringQuery(
  value: unknown,
  field: string,
  options: { maxLength?: number; trim?: boolean } = {},
): string | undefined {
  const raw = getSingleQueryValue(value, field);
  if (raw === undefined) return undefined;

  const parsed = options.trim === false ? raw : raw.trim();
  if (parsed.length === 0) return undefined;

  if (options.maxLength !== undefined && parsed.length > options.maxLength) {
    throw badRequest(`${field} must be ${options.maxLength} characters or fewer`);
  }

  return parsed;
}

export function parseDateQuery(value: unknown, field: string): string | undefined {
  const raw = getSingleQueryValue(value, field);
  if (raw === undefined) return undefined;

  if (!isStrictDate(raw)) {
    throw badRequest(`Invalid ${field}`);
  }

  return raw;
}

export function isStrictDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
