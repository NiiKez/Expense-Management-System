import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../utils/errors';
import logger from '../config/logger';
import { summarizeHttpError } from '../utils/logSanitizer';

function getHttpErrorStatus(err: Error): number | null {
  const candidate = err as Error & { status?: unknown; statusCode?: unknown; expose?: unknown };
  const status = typeof candidate.status === 'number'
    ? candidate.status
    : typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : null;

  return status !== null && status >= 400 && status < 500 ? status : null;
}

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded receipt must be 5MB or smaller'
      : 'Invalid file upload';

    logger.warn('File upload rejected', { code: err.code, field: err.field });

    res.status(400).json({
      success: false,
      error: {
        message,
        statusCode: 400,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    logger.warn('Operational error', { statusCode: err.statusCode, message: err.message });

    res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    });
    return;
  }

  const httpStatus = getHttpErrorStatus(err);
  if (httpStatus) {
    const message = httpStatus === 400 ? 'Invalid request' : err.message;
    logger.warn('HTTP request error', {
      statusCode: httpStatus,
      message: err.message,
      type: (err as Error & { type?: unknown }).type,
    });

    res.status(httpStatus).json({
      success: false,
      error: {
        message,
        statusCode: httpStatus,
      },
    });
    return;
  }

  // Unexpected / programmer errors
  logger.error('Unhandled error', { err: summarizeHttpError(err) });

  res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      statusCode: 500,
    },
  });
};
