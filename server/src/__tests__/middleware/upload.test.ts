import { Request, Response, NextFunction } from 'express';

// ── Mocks ──────────────────────────────────────────────────────────
//
// upload.ts wires multer at import time: `multer.diskStorage({...})` builds the
// storage engine and `multer({...})` builds the instance. Neither the private
// `fileFilter` nor the storage callbacks are exported, so we mock multer to
// CAPTURE the options object it is constructed with — that lets us drive the
// real fileFilter / destination / filename callbacks directly in unit tests
// without spinning up an HTTP request.
jest.mock('multer', () => {
  const diskStorage = jest.fn((opts: unknown) => {
    (diskStorage as unknown as { options: unknown }).options = opts;
    return { __mockStorage: true };
  });
  const multerFn = jest.fn((opts: unknown) => {
    (multerFn as unknown as { options: unknown }).options = opts;
    return { single: jest.fn(() => 'receipt-upload-mw') };
  });
  (multerFn as unknown as { diskStorage: typeof diskStorage }).diskStorage = diskStorage;
  return { __esModule: true, default: multerFn };
});

// The destination callback calls fs.mkdir; stub it so it invokes its callback
// without ever touching the real disk.
jest.mock('fs', () => ({
  __esModule: true,
  default: {
    mkdir: jest.fn(
      (_dir: string, _opts: unknown, cb: (err: NodeJS.ErrnoException | null, dir?: string) => void) =>
        cb(null),
    ),
  },
}));

// Keep the real receiptFiles constants/path-logic, but stub the two functions
// validateReceiptUpload delegates to so we can assert the unlink-on-reject path.
jest.mock('../../utils/receiptFiles', () => {
  const actual = jest.requireActual('../../utils/receiptFiles');
  return {
    __esModule: true,
    ...actual,
    assertReceiptFileIsSafe: jest.fn(),
    safeUnlinkReceipt: jest.fn(),
  };
});

import multer from 'multer';
import fs from 'fs';
import { upload, validateReceiptUpload } from '../../middleware/upload';
import {
  MAX_RECEIPT_FILE_SIZE,
  RECEIPT_UPLOAD_DIR,
  assertReceiptFileIsSafe,
  safeUnlinkReceipt,
} from '../../utils/receiptFiles';
import { AppError, badRequest } from '../../utils/errors';

type MockFn = jest.Mock;
type FileFilterCb = (error: Error | null, acceptFile?: boolean) => void;
type StorageCb = (error: Error | null, value?: string) => void;

// Captured-at-import multer options.
const multerOptions = (multer as unknown as { options: { fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCb) => void; limits: Record<string, number> } }).options;
const storageOptions = (multer as unknown as { diskStorage: { options: { destination: (req: Request, file: Express.Multer.File, cb: StorageCb) => void; filename: (req: Request, file: Express.Multer.File, cb: StorageCb) => void } } }).diskStorage.options;

const mkdirMock = (fs as unknown as { mkdir: MockFn }).mkdir;
const mockedAssert = assertReceiptFileIsSafe as jest.MockedFunction<typeof assertReceiptFileIsSafe>;
const mockedUnlink = safeUnlinkReceipt as jest.MockedFunction<typeof safeUnlinkReceipt>;

const fakeFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({ mimetype: 'image/png', path: `${RECEIPT_UPLOAD_DIR}/x.png`, ...overrides } as Express.Multer.File);

beforeEach(() => {
  jest.clearAllMocks();
});

// ── multer wiring: limits ──────────────────────────────────────────

describe('upload multer configuration', () => {
  it('caps a receipt at the 5MB size limit and to a single file', () => {
    // multer enforces oversize uploads via this limit (LIMIT_FILE_SIZE), so the
    // unit-level guarantee is that the cap is wired to MAX_RECEIPT_FILE_SIZE.
    expect(multerOptions.limits.fileSize).toBe(MAX_RECEIPT_FILE_SIZE);
    expect(multerOptions.limits.files).toBe(1);
  });

  it('exposes a single("receipt") middleware factory', () => {
    expect(typeof (upload as unknown as { single: unknown }).single).toBe('function');
  });

  it('wires the anti-abuse multipart caps (fields, parts, fieldSize), not just fileSize/files', () => {
    // Without these, a multipart body could carry unbounded non-file fields/parts
    // to exhaust memory even though the single file is size-capped.
    expect(multerOptions.limits.fields).toBe(10);
    expect(multerOptions.limits.parts).toBe(12);
    expect(multerOptions.limits.fieldSize).toBe(10 * 1024);
  });
});

// ── fileFilter: MIME allowlist ─────────────────────────────────────

describe('upload fileFilter — MIME allowlist', () => {
  it.each(['image/jpeg', 'image/png', 'application/pdf'])(
    'accepts allowed mime type %s',
    (mime) => {
      const cb = jest.fn();
      multerOptions.fileFilter({} as Request, fakeFile({ mimetype: mime }), cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    },
  );

  it.each([
    'image/gif',
    'image/svg+xml',
    'application/octet-stream',
    'text/html',
    'application/x-msdownload',
    'application/pdf ', // trailing space: not an exact match
    '',
    'IMAGE/PNG', // case-sensitive: must not match
  ])('rejects disallowed mime type %s with a 400 AppError', (mime) => {
    const cb = jest.fn();
    multerOptions.fileFilter({} as Request, fakeFile({ mimetype: mime }), cb);

    expect(cb).toHaveBeenCalledTimes(1);
    const err = cb.mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid file type. Only PDF, JPG, and PNG files are allowed.');
    // The file must NOT be accepted: there is no truthy second arg.
    expect(cb.mock.calls[0][1]).toBeUndefined();
  });
});

// ── storage: destination + filename ────────────────────────────────

describe('upload storage engine', () => {
  it('creates the uploads dir (recursive) and resolves the destination to RECEIPT_UPLOAD_DIR', () => {
    const cb = jest.fn();
    storageOptions.destination({} as Request, fakeFile(), cb);

    expect(mkdirMock).toHaveBeenCalledWith(
      RECEIPT_UPLOAD_DIR,
      { recursive: true },
      expect.any(Function),
    );
    expect(cb).toHaveBeenCalledWith(null, RECEIPT_UPLOAD_DIR);
  });

  it('propagates an mkdir error to the destination callback', () => {
    const mkdirErr = new Error('EACCES') as NodeJS.ErrnoException;
    mkdirMock.mockImplementationOnce(
      (_dir: string, _opts: unknown, cb: (err: NodeJS.ErrnoException | null, dir?: string) => void) =>
        cb(mkdirErr, RECEIPT_UPLOAD_DIR),
    );
    const cb = jest.fn();
    storageOptions.destination({} as Request, fakeFile(), cb);

    expect(cb).toHaveBeenCalledWith(mkdirErr, RECEIPT_UPLOAD_DIR);
  });

  it.each([
    ['image/jpeg', /^[0-9a-f-]{36}\.jpg$/],
    ['image/png', /^[0-9a-f-]{36}\.png$/],
    ['application/pdf', /^[0-9a-f-]{36}\.pdf$/],
  ] as Array<[string, RegExp]>)(
    'names a %s upload with a random uuid and the mapped extension',
    (mime, pattern) => {
      const cb = jest.fn();
      storageOptions.filename({} as Request, fakeFile({ mimetype: mime }), cb);

      expect(cb).toHaveBeenCalledTimes(1);
      const [err, name] = cb.mock.calls[0] as [Error | null, string];
      expect(err).toBeNull();
      expect(name).toMatch(pattern);
    },
  );

  it('emits a uuid with no extension for an unmapped mime type (no attacker-chosen ext)', () => {
    const cb = jest.fn();
    storageOptions.filename({} as Request, fakeFile({ mimetype: 'application/zip' }), cb);

    const [, name] = cb.mock.calls[0] as [Error | null, string];
    expect(name).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ── validateReceiptUpload: magic-byte sniff + unlink-on-reject ──────

describe('validateReceiptUpload', () => {
  const next = (): jest.MockedFunction<NextFunction> => jest.fn();

  it('passes straight through when there is no uploaded file', async () => {
    const n = next();
    await validateReceiptUpload({} as Request, {} as Response, n);

    expect(n).toHaveBeenCalledWith();
    expect(mockedAssert).not.toHaveBeenCalled();
    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('accepts a file whose content passes the magic-byte check and calls next() with no error', async () => {
    mockedAssert.mockResolvedValue(undefined);
    const n = next();
    const req = { file: { path: `${RECEIPT_UPLOAD_DIR}/ok.png`, mimetype: 'image/png' } } as unknown as Request;

    await validateReceiptUpload(req, {} as Response, n);

    expect(mockedAssert).toHaveBeenCalledWith(`${RECEIPT_UPLOAD_DIR}/ok.png`, 'image/png');
    expect(n).toHaveBeenCalledWith();
    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('deletes the temp file and forwards the error when magic bytes do not match the declared type', async () => {
    const sniffError = badRequest('Uploaded receipt content does not match the declared file type.');
    mockedAssert.mockRejectedValue(sniffError);
    mockedUnlink.mockResolvedValue(undefined);
    const n = next();
    const req = { file: { path: `${RECEIPT_UPLOAD_DIR}/spoof.pdf`, mimetype: 'application/pdf' } } as unknown as Request;

    await validateReceiptUpload(req, {} as Response, n);

    // Reject path: the just-saved temp file is removed BEFORE the error is forwarded.
    expect(mockedUnlink).toHaveBeenCalledWith(`${RECEIPT_UPLOAD_DIR}/spoof.pdf`);
    expect(n).toHaveBeenCalledWith(sniffError);
    expect((mockedUnlink as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((n as jest.Mock).mock.invocationCallOrder[0]);
  });

  it('still unlinks and forwards the error even if the sniff throws a generic (non-AppError) failure', async () => {
    const diskErr = new Error('disk read failed');
    mockedAssert.mockRejectedValue(diskErr);
    mockedUnlink.mockResolvedValue(undefined);
    const n = next();
    const req = { file: { path: `${RECEIPT_UPLOAD_DIR}/a.png`, mimetype: 'image/png' } } as unknown as Request;

    await validateReceiptUpload(req, {} as Response, n);

    expect(mockedUnlink).toHaveBeenCalledWith(`${RECEIPT_UPLOAD_DIR}/a.png`);
    expect(n).toHaveBeenCalledWith(diskErr);
  });
});
