import multer from 'multer';
import fs from 'fs';
import crypto from 'crypto';
import { badRequest } from '../utils/errors';
import { Request, Response, NextFunction } from 'express';
import {
  ALLOWED_RECEIPT_MIME_TYPES,
  assertReceiptFileIsSafe,
  MAX_RECEIPT_FILE_SIZE,
  RECEIPT_EXTENSIONS_BY_MIME_TYPE,
  RECEIPT_UPLOAD_DIR,
  safeUnlinkReceipt,
} from '../utils/receiptFiles';

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => {
    fs.mkdir(RECEIPT_UPLOAD_DIR, { recursive: true }, (err) => cb(err, RECEIPT_UPLOAD_DIR));
  },
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    const ext = RECEIPT_EXTENSIONS_BY_MIME_TYPE[file.mimetype] || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_RECEIPT_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(badRequest('Invalid file type. Only PDF, JPG, and PNG files are allowed.'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_RECEIPT_FILE_SIZE,
    files: 1,
    fields: 10,
    parts: 12,
    fieldSize: 10 * 1024,
  },
});

export const validateReceiptUpload = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!req.file) {
    next();
    return;
  }

  try {
    await assertReceiptFileIsSafe(req.file.path, req.file.mimetype);
    next();
  } catch (err) {
    await safeUnlinkReceipt(req.file.path);
    next(err);
  }
};
