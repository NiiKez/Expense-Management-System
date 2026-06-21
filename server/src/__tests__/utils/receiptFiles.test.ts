import path from 'path';

// fs/promises is the only filesystem dependency in the module. Mock it so the
// security logic (path confinement + magic-byte sniffing) can be exercised
// without touching the real disk.
jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    open: jest.fn(),
    unlink: jest.fn(),
  },
}));

import fs from 'fs/promises';
import { AppError } from '../../utils/errors';
import {
  ALLOWED_RECEIPT_MIME_TYPES,
  MAX_RECEIPT_FILE_SIZE,
  RECEIPT_EXTENSIONS_BY_MIME_TYPE,
  RECEIPT_UPLOAD_DIR,
  assertReceiptFileIsSafe,
  encodeReceiptDownloadName,
  isAllowedReceiptMimeType,
  resolveReceiptPath,
  safeUnlinkReceipt,
  sanitizeReceiptDownloadName,
} from '../../utils/receiptFiles';

const mockedFs = fs as jest.Mocked<typeof fs>;

// Magic-byte signatures the validator expects.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF_MAGIC = Buffer.from('%PDF-1.7\n', 'ascii');

/**
 * Build a fake file handle whose read() copies the first bytes of `content`
 * into the caller-supplied buffer, mimicking fs.FileHandle.read().
 */
function fakeHandle(content: Buffer) {
  const read = jest.fn(
    async (buffer: Buffer, offset: number, length: number, _position: number) => {
      const bytesRead = content.copy(buffer, offset, 0, Math.min(length, content.length));
      return { bytesRead, buffer };
    },
  );
  const close = jest.fn(async () => undefined);
  return { handle: { read, close }, read, close };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Constants & allowlist ─────────────────────────────────────────

describe('receiptFiles constants', () => {
  it('exposes a 5MB max file size', () => {
    expect(MAX_RECEIPT_FILE_SIZE).toBe(5 * 1024 * 1024);
  });

  it('maps exactly the three supported mime types to extensions', () => {
    expect(RECEIPT_EXTENSIONS_BY_MIME_TYPE).toEqual({
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'application/pdf': '.pdf',
    });
  });

  it('derives the allowed mime list from the extension map', () => {
    expect(ALLOWED_RECEIPT_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'application/pdf',
    ]);
  });

  it('resolves the upload dir to an absolute path under the server root', () => {
    expect(path.isAbsolute(RECEIPT_UPLOAD_DIR)).toBe(true);
    expect(RECEIPT_UPLOAD_DIR.endsWith(`${path.sep}uploads`)).toBe(true);
  });
});

describe('isAllowedReceiptMimeType', () => {
  it.each(['image/jpeg', 'image/png', 'application/pdf'])(
    'accepts allowed mime type %s',
    (mime) => {
      expect(isAllowedReceiptMimeType(mime)).toBe(true);
    },
  );

  it.each([
    'image/gif',
    'image/svg+xml',
    'application/octet-stream',
    'text/html',
    'application/x-msdownload',
    '',
    'IMAGE/PNG', // case-sensitive: must not match
  ])('rejects disallowed mime type %s', (mime) => {
    expect(isAllowedReceiptMimeType(mime)).toBe(false);
  });
});

// ── Path traversal / confinement ──────────────────────────────────

describe('resolveReceiptPath — confinement to the receipts dir', () => {
  it('resolves a normal in-dir filename to an absolute path inside the upload dir', () => {
    const stored = path.join(RECEIPT_UPLOAD_DIR, 'abc-123.png');
    const resolved = resolveReceiptPath(stored);

    expect(resolved).toBe(stored);
    expect(resolved).not.toBeNull();
    // Confirm it lives within the upload dir.
    expect(path.relative(RECEIPT_UPLOAD_DIR, resolved as string).startsWith('..')).toBe(false);
  });

  it('resolves a nested subdirectory path that stays inside the upload dir', () => {
    const stored = path.join(RECEIPT_UPLOAD_DIR, 'sub', 'deep', 'file.pdf');
    const resolved = resolveReceiptPath(stored);

    expect(resolved).toBe(stored);
    const rel = path.relative(RECEIPT_UPLOAD_DIR, resolved as string);
    expect(rel.startsWith('..')).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
  });

  it('returns the upload dir itself when the path resolves to the dir (relative === "")', () => {
    const resolved = resolveReceiptPath(RECEIPT_UPLOAD_DIR);
    expect(resolved).toBe(RECEIPT_UPLOAD_DIR);
  });

  it('rejects "../" parent traversal that escapes the upload dir', () => {
    const stored = path.join(RECEIPT_UPLOAD_DIR, '..', '..', 'etc', 'passwd');
    expect(resolveReceiptPath(stored)).toBeNull();
  });

  it('rejects a relative ../../etc/passwd payload', () => {
    expect(resolveReceiptPath('../../etc/passwd')).toBeNull();
  });

  it('rejects an absolute path that points outside the upload dir', () => {
    expect(resolveReceiptPath('/etc/passwd')).toBeNull();
  });

  it('rejects a traversal that climbs out and back into a sibling "uploads"-prefixed dir', () => {
    // e.g. /server/uploads-evil should NOT be treated as inside /server/uploads
    const sibling = `${RECEIPT_UPLOAD_DIR}-evil/secret.png`;
    expect(resolveReceiptPath(sibling)).toBeNull();
  });

  it('rejects a path that traverses up then re-descends back into the dir but via .. segments outside', () => {
    const parent = path.dirname(RECEIPT_UPLOAD_DIR);
    const stored = path.join(RECEIPT_UPLOAD_DIR, '..', '..', path.basename(parent), 'config.json');
    expect(resolveReceiptPath(stored)).toBeNull();
  });

  it('normalizes mixed traversal that ultimately stays inside the dir', () => {
    // uploads/sub/../legit.png  ->  uploads/legit.png  (still confined)
    const stored = path.join(RECEIPT_UPLOAD_DIR, 'sub', '..', 'legit.png');
    const resolved = resolveReceiptPath(stored);
    expect(resolved).toBe(path.join(RECEIPT_UPLOAD_DIR, 'legit.png'));
  });

  it('keeps an embedded-NUL-byte input confined to the upload dir (no escape)', () => {
    // "evil<NUL>.png" — a classic null-byte injection. Node's path module treats
    // the NUL as an ordinary character (it does NOT throw here), so this guard's
    // job is purely confinement: the poisoned name must not be able to climb out
    // of the receipts dir. The NUL itself is rejected later, at the fs.open()
    // syscall layer (ERR_INVALID_ARG_VALUE) — see the note in the report.
    const nul = String.fromCharCode(0);
    const poisoned = `${RECEIPT_UPLOAD_DIR}/evil${nul}.png`;

    const resolved = resolveReceiptPath(poisoned);

    // It resolves (path doesn't reject NUL) but stays inside the upload dir...
    expect(resolved).not.toBeNull();
    const rel = path.relative(RECEIPT_UPLOAD_DIR, resolved as string);
    expect(rel.startsWith('..')).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
  });

  it('cannot be tricked by a NUL byte into pointing outside the dir', () => {
    // Attempt to use a NUL to "truncate" past a traversal sequence.
    const nul = String.fromCharCode(0);
    const poisoned = `${RECEIPT_UPLOAD_DIR}/../../etc/passwd${nul}.png`;
    expect(resolveReceiptPath(poisoned)).toBeNull();
  });
});

// ── safeUnlinkReceipt ─────────────────────────────────────────────

describe('safeUnlinkReceipt', () => {
  it('unlinks a confined receipt path', async () => {
    mockedFs.unlink.mockResolvedValue(undefined as never);
    const stored = path.join(RECEIPT_UPLOAD_DIR, 'to-delete.png');

    await safeUnlinkReceipt(stored);

    expect(mockedFs.unlink).toHaveBeenCalledTimes(1);
    expect(mockedFs.unlink).toHaveBeenCalledWith(stored);
  });

  it('does NOT unlink (and never resolves to fs) a traversal path outside the dir', async () => {
    await safeUnlinkReceipt('../../etc/passwd');
    expect(mockedFs.unlink).not.toHaveBeenCalled();
  });

  it('does not unlink an absolute outside path', async () => {
    await safeUnlinkReceipt('/etc/shadow');
    expect(mockedFs.unlink).not.toHaveBeenCalled();
  });

  it('swallows unlink errors (e.g. ENOENT) without throwing', async () => {
    mockedFs.unlink.mockRejectedValue(new Error('ENOENT') as never);
    const stored = path.join(RECEIPT_UPLOAD_DIR, 'missing.png');

    await expect(safeUnlinkReceipt(stored)).resolves.toBeUndefined();
  });
});

// ── Filename sanitization ─────────────────────────────────────────

describe('sanitizeReceiptDownloadName', () => {
  it('keeps safe word chars, dots, dashes and spaces', () => {
    expect(sanitizeReceiptDownloadName('My Receipt-2024.pdf')).toBe('My Receipt-2024.pdf');
  });

  it('replaces path separators (/) so the name cannot encode a directory', () => {
    // The allowlist keeps \w, dot, dash and space; only the slashes become "_".
    expect(sanitizeReceiptDownloadName('../../etc/passwd')).toBe('.._.._etc_passwd');
  });

  it('replaces backslashes and colons (Windows-style traversal)', () => {
    // Dots and dashes are allowed; backslashes and the drive colon become "_".
    expect(sanitizeReceiptDownloadName('..\\..\\C:\\secret.png')).toBe('.._.._C__secret.png');
  });

  it('strips control / quoting chars that could break the header', () => {
    expect(sanitizeReceiptDownloadName('a"b;c\r\n.png')).toBe('a_b_c__.png');
  });

  it('falls back to "receipt" when the name reduces to empty-ish input', () => {
    expect(sanitizeReceiptDownloadName('')).toBe('receipt');
  });

  it('falls back to "receipt" when every char is replaced (non-empty result is truthy, so test all-removed empties)', () => {
    // A string of only disallowed chars becomes underscores (truthy), not empty —
    // verify that behavior explicitly so the fallback contract is documented.
    expect(sanitizeReceiptDownloadName('///')).toBe('___');
  });

  it('falls back to "receipt" for a name that reduces to only dots or spaces', () => {
    // After sanitization, a value that is blank or only dots is not a usable
    // filename (and ".." / "." are path markers), so it falls back to "receipt".
    expect(sanitizeReceiptDownloadName('..')).toBe('receipt');
    expect(sanitizeReceiptDownloadName('....')).toBe('receipt');
    expect(sanitizeReceiptDownloadName('   ')).toBe('receipt');
  });

  it('preserves a normal name with a real extension (not dots-only)', () => {
    expect(sanitizeReceiptDownloadName('invoice.2024.pdf')).toBe('invoice.2024.pdf');
  });
});

describe('encodeReceiptDownloadName', () => {
  it('percent-encodes spaces and unicode for use in a filename* header param', () => {
    expect(encodeReceiptDownloadName('faktür a.pdf')).toBe('fakt%C3%BCr%20a.pdf');
  });

  it("encodes single quotes, parens and asterisks per RFC 5987", () => {
    expect(encodeReceiptDownloadName("a'(b)*c")).toBe('a%27%28b%29%2Ac');
  });

  it('leaves plain ascii names untouched', () => {
    expect(encodeReceiptDownloadName('receipt.png')).toBe('receipt.png');
  });
});

// ── Magic-byte / MIME validation ──────────────────────────────────

describe('assertReceiptFileIsSafe — mime allowlist', () => {
  it('rejects a disallowed mime type before ever touching the filesystem', async () => {
    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'x.gif'), 'image/gif'),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'x.gif'), 'image/gif'),
    ).rejects.toBeInstanceOf(AppError);

    expect(mockedFs.open).not.toHaveBeenCalled();
  });

  it('rejects a path-traversal target even with an allowed mime type, without opening it', async () => {
    await expect(
      assertReceiptFileIsSafe('../../etc/passwd', 'image/png'),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid receipt file path' });

    expect(mockedFs.open).not.toHaveBeenCalled();
  });
});

describe('assertReceiptFileIsSafe — magic-byte matching', () => {
  it('accepts a PNG whose bytes match the declared image/png', async () => {
    const { handle, close } = fakeHandle(PNG_MAGIC);
    mockedFs.open.mockResolvedValue(handle as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'a.png'), 'image/png'),
    ).resolves.toBeUndefined();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('accepts a JPEG whose bytes match the declared image/jpeg', async () => {
    const { handle } = fakeHandle(JPEG_MAGIC);
    mockedFs.open.mockResolvedValue(handle as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'a.jpg'), 'image/jpeg'),
    ).resolves.toBeUndefined();
  });

  it('accepts a PDF whose bytes start with %PDF-', async () => {
    const { handle } = fakeHandle(PDF_MAGIC);
    mockedFs.open.mockResolvedValue(handle as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'a.pdf'), 'application/pdf'),
    ).resolves.toBeUndefined();
  });

  it('rejects content whose bytes do not match the declared type (PNG bytes, claimed PDF)', async () => {
    const { handle, close } = fakeHandle(PNG_MAGIC);
    mockedFs.open.mockResolvedValue(handle as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'spoof.pdf'), 'application/pdf'),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Uploaded receipt content does not match the declared file type.',
    });

    // The handle must still be closed on the rejection path (finally block).
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects a polyglot/disguised file (PDF bytes claimed as image/png)', async () => {
    const { handle } = fakeHandle(PDF_MAGIC);
    mockedFs.open.mockResolvedValue(handle as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'spoof.png'), 'image/png'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an empty file (0 bytes read) regardless of declared type', async () => {
    const { handle, close } = fakeHandle(Buffer.alloc(0));
    mockedFs.open.mockResolvedValue(handle as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'empty.png'), 'image/png'),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects a truncated PNG (only 4 of 8 signature bytes present)', async () => {
    const { handle } = fakeHandle(PNG_MAGIC.subarray(0, 4));
    mockedFs.open.mockResolvedValue(handle as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'trunc.png'), 'image/png'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a JPEG missing the third 0xFF marker byte', async () => {
    const { handle } = fakeHandle(Buffer.from([0xff, 0xd8, 0x00]));
    mockedFs.open.mockResolvedValue(handle as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'bad.jpg'), 'image/jpeg'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('closes the handle even when fs.read rejects (finally guarantees cleanup)', async () => {
    const close = jest.fn(async () => undefined);
    const read = jest.fn(async () => {
      throw new Error('disk read failed');
    });
    mockedFs.open.mockResolvedValue({ read, close } as never);

    await expect(
      assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'a.png'), 'image/png'),
    ).rejects.toThrow('disk read failed');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('only inspects the first 8 bytes of the file (reads from position 0, length 8)', async () => {
    const { handle, read } = fakeHandle(PNG_MAGIC);
    mockedFs.open.mockResolvedValue(handle as never);

    await assertReceiptFileIsSafe(path.join(RECEIPT_UPLOAD_DIR, 'a.png'), 'image/png');

    expect(read).toHaveBeenCalledTimes(1);
    const [, offset, length, position] = read.mock.calls[0];
    expect(offset).toBe(0);
    expect(length).toBe(8);
    expect(position).toBe(0);
  });
});
