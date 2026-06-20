// Minimal, dependency-free CSV serialization with spreadsheet-injection
// protection. Used by the export endpoints.

export type CsvValue = string | number | boolean | Date | null | undefined;

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);

  // Formula-injection guard (CWE-1236): a cell beginning with =, +, -, @ or a
  // control char (tab/CR/LF) can be executed as a formula by Excel/Sheets/
  // LibreOffice on open. Spreadsheets also STRIP leading whitespace before
  // evaluating, so " =1+1" is still a live formula — hence the optional \s*
  // before the formula chars. Prefix with a single quote to force literal text.
  if (/^\s*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) {
    s = `'${s}`;
  }

  // Quote fields containing the delimiter, quotes, or newlines (doubling quotes).
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize a header row + data rows to a CSV string (CRLF line endings). */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(escapeField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeField).join(','));
  }
  // Trailing CRLF so the file ends on a clean newline.
  return `${lines.join('\r\n')}\r\n`;
}

// CSV date helpers: DATE columns as YYYY-MM-DD, timestamps as full ISO.
//
// mysql2 returns a DATE column as a Date at *local* midnight. Calling
// toISOString() on it would convert to UTC and shift the calendar day across
// the timezone boundary (e.g. 2026-03-10 local → 2026-03-09 UTC). So format
// DATE values from their local components; strings (already YYYY-MM-DD) pass
// through. Timestamps are true instants, so ISO is correct for them.
export const csvDate = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v as string);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
export const csvTimestamp = (v: unknown): string =>
  v ? new Date(v as string).toISOString() : '';
