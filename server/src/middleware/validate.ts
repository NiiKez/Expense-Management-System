import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { safeUnlinkReceipt } from '../utils/receiptFiles';

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      // Always clean up the uploaded file on any validation failure path —
      // a non-Zod throw would otherwise orphan the file on disk.
      if (req.file) {
        safeUnlinkReceipt(req.file.path).catch(() => {});
      }

      if (err instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            statusCode: 400,
            details: err.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        });
        return;
      }
      next(err);
    }
  };
};
