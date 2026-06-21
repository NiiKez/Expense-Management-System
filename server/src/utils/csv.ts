// Minimal, dependency-free CSV serialization with spreadsheet-injection
// protection. Used by the export endpoints.

export type CsvValue = string | number | boolean | Date | null | undefined;

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);

  // Formula-injection guard (CWE-1236): a cell beginning with =, +, -, @ can be
  // executed as a formula by Excel/Sheets/LibreOffice on open. Spreadsheets also
  // STRIP leading whitespace before evaluating, so " =1+1" is still a live
  // formula; and leading C0 control chars (\x00–\x1F, e.g. tab/CR/LF/vertical
  // tab/NUL) can likewise be abused as lead-ins. Prefix any value whose first
  // character is whitespace, a formula char, or a C0 control char with a single
  // apostrophe to force the spreadsheet to treat the cell as literal text.
  // eslint-disable-next-line no-control-regex -- intentional: neutralizing leading C0 control chars
  if (/^[\s=+\-@\x00-\x1F]/.test(s)) {
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
export const csvTimestamp = (v: unknown): string => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v as string);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};
