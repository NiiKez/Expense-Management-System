import { toCsv, csvDate, csvTimestamp, CsvValue } from '@/utils/csv';

// csv.ts is a pure, dependency-free serializer with a spreadsheet
// (CSV/formula) injection guard. These tests assert EXACT output strings so
// they double as executable documentation of the security contract: any change
// that weakens the neutralization of a dangerous leading character will break a
// test here.
//
// `escapeField` is not exported, so we exercise it through the public `toCsv`
// surface (a single-column, single-row CSV is `header\r\nfield\r\n`).

/** Helper: serialize a one-cell body and return just the escaped data cell. */
function escapeOne(value: CsvValue): string {
  const out = toCsv(['h'], [[value]]);
  // Layout is `h\r\n<cell>\r\n`. Strip the header line and the trailing CRLF.
  return out.slice('h\r\n'.length, -'\r\n'.length);
}

describe('csv — escapeField (formula-injection guard)', () => {
  // ── Each dangerous leading char must be neutralized with a leading quote ──
  // CWE-1236: a cell starting with one of these can be executed as a formula
  // by Excel / Google Sheets / LibreOffice on open. Prefixing a single quote
  // forces the spreadsheet to treat the cell as literal text.

  it("neutralizes a leading '=' (formula) by prefixing a single quote", () => {
    expect(escapeOne('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
  });

  it("neutralizes a leading '+' by prefixing a single quote", () => {
    expect(escapeOne('+1234567890')).toBe("'+1234567890");
  });

  it("neutralizes a leading '-' by prefixing a single quote", () => {
    // Note: a leading minus is dangerous in spreadsheets even though it also
    // looks like a negative number; the guard prefixes it regardless.
    expect(escapeOne('-2+3')).toBe("'-2+3");
  });

  it("neutralizes a leading '@' by prefixing a single quote", () => {
    expect(escapeOne('@SUM(1)')).toBe("'@SUM(1)");
  });

  it('neutralizes a leading tab (\\t) by prefixing a single quote (no quoting needed)', () => {
    // Tab is a formula-injection lead-in but is NOT one of the chars that
    // triggers RFC-4180 quoting, so the output is just the prefixed string.
    expect(escapeOne('\tcmd')).toBe("'\tcmd");
  });

  it('neutralizes a leading carriage return (\\r): prefixed AND RFC-4180 quoted', () => {
    // CR triggers BOTH the formula guard (leading char) and the quoting rule
    // (it is in [",\n\r]). So the cell is first prefixed with ', then the whole
    // thing is wrapped in double quotes.
    expect(escapeOne('\rmalicious')).toBe('"\'\rmalicious"');
  });

  it('neutralizes a leading char even when the formula payload contains commas (quoted)', () => {
    // `=cmd|'/C calc'!A1` style payload with a comma: prefixed then quoted.
    expect(escapeOne('=1,2')).toBe('"\'=1,2"');
  });

  it('does NOT prefix when the dangerous char is not the FIRST character', () => {
    // The guard is anchored to the start (^). A '=' in the middle is harmless
    // as a formula trigger and must pass through unmodified.
    expect(escapeOne('a=b')).toBe('a=b');
    expect(escapeOne('1-2')).toBe('1-2');
    expect(escapeOne('user@host')).toBe('user@host');
  });
});

describe('csv — escapeField (leading-whitespace formula bypass)', () => {
  // Excel / Google Sheets / LibreOffice TRIM leading whitespace before deciding
  // whether a cell is a formula, so " =1+1" (leading space) is still evaluated.
  // A guard anchored strictly to the first char would let these through. The
  // \s* before the formula chars closes that bypass.

  it("neutralizes a leading space before '=' (whitespace-trimmed formula)", () => {
    expect(escapeOne(' =1+1')).toBe("' =1+1");
  });

  it('neutralizes multiple leading spaces before a formula char', () => {
    expect(escapeOne('   +1234567890')).toBe("'   +1234567890");
  });

  it("neutralizes a leading tab before '@' (control char + formula)", () => {
    // The leading \t triggers the control-char arm of the guard; prefixed.
    expect(escapeOne('\t@SUM(1)')).toBe("'\t@SUM(1)");
  });

  it('neutralizes a leading newline before a formula (prefixed AND quoted)', () => {
    // Leading \n is a control char (guard fires) and is also in [",\n\r] so the
    // cell is prefixed with ' then RFC-4180 quoted.
    expect(escapeOne('\n=evil()')).toBe('"\'\n=evil()"');
  });

  it('neutralizes ANY leading whitespace, even with no formula char following', () => {
    // Spreadsheets strip leading whitespace before deciding if a cell is a
    // formula, so a value that merely *starts* with whitespace is treated as a
    // potential lead-in and prefixed defensively.
    expect(escapeOne('  hello world')).toBe("'  hello world");
  });

  it('neutralizes a leading TAB before a formula char (\\t=)', () => {
    expect(escapeOne('\t=1+1')).toBe("'\t=1+1");
  });

  it('neutralizes a leading vertical tab (\\x0B) before a formula char', () => {
    // \x0B is a C0 control char AND whitespace; not in [",\n\r] so no quoting.
    expect(escapeOne('\x0B=1+1')).toBe("'\x0B=1+1");
  });

  it('neutralizes a leading NUL (\\x00) control char', () => {
    // NUL is a C0 control char; it must be prefixed even with no formula char.
    expect(escapeOne('\x00danger')).toBe("'\x00danger");
  });

  it('does NOT prefix a normal value that starts with a letter or digit', () => {
    expect(escapeOne('Office supplies')).toBe('Office supplies');
    expect(escapeOne('42 widgets')).toBe('42 widgets');
  });
});

describe('csv — escapeField (RFC 4180 delimiter / quote escaping)', () => {
  it('wraps a field containing a comma in double quotes', () => {
    expect(escapeOne('Lunch, dinner')).toBe('"Lunch, dinner"');
  });

  it('wraps a field containing a double-quote and doubles the embedded quote', () => {
    expect(escapeOne('say "hi"')).toBe('"say ""hi"""');
  });

  it('doubles every embedded double-quote', () => {
    expect(escapeOne('a"b"c')).toBe('"a""b""c"');
  });

  it('wraps a field containing a newline (\\n) in double quotes', () => {
    expect(escapeOne('line1\nline2')).toBe('"line1\nline2"');
  });

  it('wraps a field containing a carriage return (\\r) when it is not the first char', () => {
    expect(escapeOne('line1\rline2')).toBe('"line1\rline2"');
  });

  it('combines comma + embedded quote correctly', () => {
    expect(escapeOne('a,"b"')).toBe('"a,""b"""');
  });
});

describe('csv — escapeField (benign + type coercion)', () => {
  it('passes a plain benign string through unmodified', () => {
    expect(escapeOne('Office supplies')).toBe('Office supplies');
  });

  it('renders null as an empty cell', () => {
    expect(escapeOne(null)).toBe('');
  });

  it('renders undefined as an empty cell', () => {
    expect(escapeOne(undefined)).toBe('');
  });

  it('renders a number via String()', () => {
    expect(escapeOne(42)).toBe('42');
    expect(escapeOne(3.5)).toBe('3.5');
  });

  it('renders a negative number with the formula-guard prefix (leading -)', () => {
    // String(-5) === '-5', which starts with '-', so the guard fires. This is
    // intentional: a cell value that LOOKS like -5 could be -5*cmd in a crafted
    // export, so the serializer prefixes it.
    expect(escapeOne(-5)).toBe("'-5");
  });

  it('renders a boolean via String()', () => {
    expect(escapeOne(true)).toBe('true');
    expect(escapeOne(false)).toBe('false');
  });

  it('renders a Date as a full ISO 8601 string', () => {
    const d = new Date('2026-03-10T12:34:56.000Z');
    expect(escapeOne(d)).toBe('2026-03-10T12:34:56.000Z');
  });

  it('renders an empty string as an empty cell', () => {
    expect(escapeOne('')).toBe('');
  });
});

describe('csv — toCsv (row/column framing)', () => {
  it('emits a header row followed by data rows, CRLF separated, with a trailing CRLF', () => {
    const csv = toCsv(['id', 'name'], [[1, 'Alice'], [2, 'Bob']]);
    expect(csv).toBe('id,name\r\n1,Alice\r\n2,Bob\r\n');
  });

  it('uses comma as the column delimiter and preserves column order', () => {
    const csv = toCsv(['a', 'b', 'c'], [['x', 'y', 'z']]);
    expect(csv).toBe('a,b,c\r\nx,y,z\r\n');
  });

  it('emits just the header (plus trailing CRLF) when there are no rows', () => {
    const csv = toCsv(['col1', 'col2'], []);
    expect(csv).toBe('col1,col2\r\n');
  });

  it('escapes cells within rows (quoting + formula guard apply per cell)', () => {
    const csv = toCsv(
      ['title', 'amount'],
      [['=cmd', 'a,b'], ['plain', '-3']],
    );
    expect(csv).toBe("title,amount\r\n'=cmd,\"a,b\"\r\nplain,'-3\r\n");
  });

  it('renders null / undefined / number / Date cells correctly in a single row', () => {
    const d = new Date('2026-06-11T00:00:00.000Z');
    const csv = toCsv(
      ['a', 'b', 'c', 'd'],
      [[null, undefined, 7, d]],
    );
    expect(csv).toBe('a,b,c,d\r\n,,7,2026-06-11T00:00:00.000Z\r\n');
  });

  it('escapes a header cell the same way as a data cell (defense in depth)', () => {
    // A header that happens to start with '=' is also neutralized.
    const csv = toCsv(['=danger', 'safe'], [['1', '2']]);
    expect(csv).toBe("'=danger,safe\r\n1,2\r\n");
  });
});

describe('csv — csvDate (timezone-safe DATE formatting)', () => {
  it('returns empty string for falsy input', () => {
    expect(csvDate(null)).toBe('');
    expect(csvDate(undefined)).toBe('');
    expect(csvDate('')).toBe('');
    expect(csvDate(0)).toBe('');
  });

  it('truncates an ISO/string value to its first 10 chars (YYYY-MM-DD)', () => {
    expect(csvDate('2026-03-10T00:00:00.000Z')).toBe('2026-03-10');
    expect(csvDate('2026-03-10')).toBe('2026-03-10');
  });

  it('formats a Date from LOCAL components (no UTC day shift)', () => {
    // Build a Date at local midnight so toISOString() could shift the day in
    // a negative-offset zone. csvDate must read the LOCAL Y/M/D instead.
    const d = new Date(2026, 2, 10); // March 10, 2026 local midnight
    expect(csvDate(d)).toBe('2026-03-10');
  });

  it('zero-pads single-digit month and day', () => {
    const d = new Date(2026, 0, 5); // Jan 5, 2026 local
    expect(csvDate(d)).toBe('2026-01-05');
  });

  it('passes a string through the slice branch WITHOUT date validation', () => {
    // A string input is assumed to already be a date-ish string and is simply
    // sliced to 10 chars — it is NOT parsed/validated. So an unparseable string
    // is returned (truncated) as-is rather than emptied. Documented as-is.
    expect(csvDate('not-a-date')).toBe('not-a-date');
  });

  it('returns empty string for an invalid Date instance', () => {
    expect(csvDate(new Date('not-a-date'))).toBe('');
  });

  it('parses a numeric epoch via new Date(...) and formats local components', () => {
    const epoch = new Date(2026, 5, 11).getTime();
    expect(csvDate(epoch)).toBe('2026-06-11');
  });
});

describe('csv — csvTimestamp (full ISO instant)', () => {
  it('returns empty string for falsy input', () => {
    expect(csvTimestamp(null)).toBe('');
    expect(csvTimestamp(undefined)).toBe('');
    expect(csvTimestamp('')).toBe('');
  });

  it('returns a full ISO 8601 timestamp for a date string', () => {
    expect(csvTimestamp('2026-03-10T12:34:56.000Z')).toBe(
      '2026-03-10T12:34:56.000Z',
    );
  });

  it('returns a full ISO 8601 timestamp for a Date instance', () => {
    const d = new Date('2026-03-10T12:34:56.000Z');
    expect(csvTimestamp(d)).toBe('2026-03-10T12:34:56.000Z');
  });

  it('returns empty string for a malformed date value instead of throwing', () => {
    // Previously .toISOString() ran unconditionally, so an unparseable value
    // threw RangeError: Invalid time value and 500'd the whole CSV export.
    expect(() => csvTimestamp('not-a-date')).not.toThrow();
    expect(csvTimestamp('not-a-date')).toBe('');
    expect(csvTimestamp(new Date('not-a-date'))).toBe('');
  });
});
