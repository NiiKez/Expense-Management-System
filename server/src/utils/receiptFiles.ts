import fs from 'fs/promises';
import path from 'path';
import { badRequest } from './errors';

export const RECEIPT_UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
export const MAX_RECEIPT_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const RECEIPT_EXTENSIONS_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

export const ALLOWED_RECEIPT_MIME_TYPES = Object.keys(RECEIPT_EXTENSIONS_BY_MIME_TYPE);

export function isAllowedReceiptMimeType(mimeType: string): boolean {
  return ALLOWED_RECEIPT_MIME_TYPES.includes(mimeType);
}

export function resolveReceiptPath(storedPath: string): string | null {
  const resolved = path.resolve(storedPath);
  const relative = path.relative(RECEIPT_UPLOAD_DIR, resolved);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }

  return null;
}

export async function safeUnlinkReceipt(storedPath: string): Promise<void> {
  const resolved = resolveReceiptPath(storedPath);
  if (!resolved) return;

  await fs.unlink(resolved).catch(() => {});
}

export function sanitizeReceiptDownloadName(fileName: string): string {
  const sanitized = fileName.replace(/[^\w.\- ]/g, '_').trim();
  // A name that reduces to nothing, or to only dots ('.', '..', '....'), is not
  // a usable filename — and dot-only names are path markers — so fall back.
  if (sanitized === '' || /^\.+$/.test(sanitized)) {
    return 'receipt';
  }
  return sanitized;
}

export function encodeReceiptDownloadName(fileName: string): string {
  return encodeURIComponent(fileName)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

export async function assertReceiptFileIsSafe(filePath: string, mimeType: string): Promise<void> {
  if (!isAllowedReceiptMimeType(mimeType)) {
    throw badRequest('Invalid file type. Only PDF, JPG, and PNG files are allowed.');
  }

  const resolved = resolveReceiptPath(filePath);
  if (!resolved) {
    throw badRequest('Invalid receipt file path');
  }

  const handle = await fs.open(resolved, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const signature = header.subarray(0, bytesRead);

    if (!matchesMimeSignature(signature, mimeType)) {
      throw badRequest('Uploaded receipt content does not match the declared file type.');
    }
  } finally {
    await handle.close();
  }
}

function matchesMimeSignature(signature: Buffer, mimeType: string): boolean {
  if (mimeType === 'application/pdf') {
    return signature.length >= 5 && signature.subarray(0, 5).toString('ascii') === '%PDF-';
  }

  if (mimeType === 'image/jpeg') {
    return signature.length >= 3
      && signature[0] === 0xff
      && signature[1] === 0xd8
      && signature[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    return signature.length >= 8
      && signature[0] === 0x89
      && signature[1] === 0x50
      && signature[2] === 0x4e
      && signature[3] === 0x47
      && signature[4] === 0x0d
      && signature[5] === 0x0a
      && signature[6] === 0x1a
      && signature[7] === 0x0a;
  }

  return false;
}
