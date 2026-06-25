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

// Fixed, status-appropriate messages for third-party/middleware HTTP errors
// (body-parser, http-errors, etc.). App errors go through AppError with their own
// intentional messages; here we never echo err.message to the client so a future
// transitive library can't leak internals — the real message stays in the log.
function genericHttpMessage(status: number): string {
  switch (status) {
    case 400: return 'Invalid request';
    case 401: return 'Unauthorized';
    case 403: return 'Forbidden';
    case 404: return 'Not found';
    case 405: return 'Method not allowed';
    case 406: return 'Not acceptable';
    case 409: return 'Conflict';
    case 413: return 'Payload too large';
    case 415: return 'Unsupported media type';
    case 429: return 'Too many requests';
    default: return 'Request error';
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.id;

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded receipt must be 5MB or smaller'
      : 'Invalid file upload';

    logger.warn('File upload rejected', { code: err.code, field: err.field, requestId });

    res.status(400).json({
      success: false,
      error: {
        message,
        statusCode: 400,
        requestId,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    logger.warn('Operational error', { statusCode: err.statusCode, message: err.message, requestId });

    res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        statusCode: err.statusCode,
        requestId,
      },
    });
    return;
  }

  const httpStatus = getHttpErrorStatus(err);
  if (httpStatus) {
    logger.warn('HTTP request error', {
      statusCode: httpStatus,
      message: err.message,
      type: (err as Error & { type?: unknown }).type,
      requestId,
    });

    res.status(httpStatus).json({
      success: false,
      error: {
        message: genericHttpMessage(httpStatus),
        statusCode: httpStatus,
        requestId,
      },
    });
    return;
  }

  // Unexpected / programmer errors
  logger.error('Unhandled error', { err: summarizeHttpError(err), requestId });

  res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      statusCode: 500,
      requestId,
    },
  });
};
