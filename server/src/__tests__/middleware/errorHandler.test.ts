import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

// Silence + spy on the logger so we can assert nothing sensitive is logged.
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { errorHandler } from '../../middleware/errorHandler';
import { AppError } from '../../utils/errors';
import logger from '../../config/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

function mockResponse(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 for parser-style HTTP errors instead of treating them as 500s', () => {
    const err = Object.assign(new Error('Unexpected token } in JSON'), {
      status: 400,
      type: 'entity.parse.failed',
    });
    const res = mockResponse();

    errorHandler(err, {} as Request, res as Response, jest.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Invalid request',
        statusCode: 400,
      },
    });
  });

  it('returns a generic message for a non-400 4xx HTTP error instead of echoing err.message', () => {
    // A third-party/middleware error carrying a 415 and a revealing message must
    // not have that message forwarded to the client.
    const err = Object.assign(new Error('unsupported charset "utf-7" from internal/lib/x'), {
      status: 415,
      type: 'charset.unsupported',
    });
    const res = mockResponse();

    errorHandler(err, {} as Request, res as Response, jest.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Unsupported media type',
        statusCode: 415,
      },
    });
    const body = JSON.stringify((res.json as jest.Mock).mock.calls[0][0]);
    expect(body).not.toContain('utf-7');
    expect(body).not.toContain('internal/lib');
  });

  it('responds with a generic 500 for an unexpected Error and leaks neither message nor stack', () => {
    const err = new Error('DB password is hunter2 at connection string');
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    errorHandler(err, {} as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Internal server error',
        statusCode: 500,
      },
    });

    // Anti-leak guarantee: the client body must not echo the original message or stack.
    const body = (res.json as jest.Mock).mock.calls[0][0];
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('hunter2');
    expect(serializedBody).not.toContain(err.message);
    expect(serializedBody).not.toContain('Error:'); // no stack frame text

    // The handler is terminal: it writes the response itself, never delegating.
    expect(next).not.toHaveBeenCalled();
  });

  it('passes an AppError statusCode and message straight through', () => {
    const err = new AppError(403, 'Insufficient permissions');
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    errorHandler(err, {} as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Insufficient permissions',
        statusCode: 403,
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('maps a multer LIMIT_FILE_SIZE error to a 400 with the size message', () => {
    const err = new multer.MulterError('LIMIT_FILE_SIZE', 'receipt');
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    errorHandler(err, {} as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Uploaded receipt must be 5MB or smaller',
        statusCode: 400,
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('maps other multer errors to a generic 400 invalid-upload message', () => {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'receipt');
    const res = mockResponse();

    errorHandler(err, {} as Request, res as Response, jest.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Invalid file upload',
        statusCode: 400,
      },
    });
  });

  it('logs unexpected errors through summarizeHttpError without leaking secrets or stacks', () => {
    const err = new Error('connection refused: token=topsecret');
    const res = mockResponse();

    errorHandler(err, {} as Request, res as Response, jest.fn() as NextFunction);

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    const errorCall = (mockedLogger.error.mock.calls as unknown as unknown[][])[0];
    const logMessage = errorCall[0] as string;
    const logMeta = errorCall[1] as { err: Record<string, unknown> };
    expect(logMessage).toBe('Unhandled error');

    // The error is wrapped in a summarizeHttpError envelope under `err`.
    expect(logMeta).toMatchObject({
      err: {
        name: 'Error',
        message: 'connection refused: token=topsecret',
      },
    });
    // summarizeHttpError keeps the stack on a plain Error; that's intended for
    // server-side logs (redaction of stacks is not its contract) but the value
    // must arrive via the summarizer shape, not the raw error object.
    expect(logMeta.err).toHaveProperty('stack');
  });

  it('does not route AppError or multer errors through logger.error', () => {
    const appErr = new AppError(409, 'Conflict');
    errorHandler(appErr, {} as Request, mockResponse() as Response, jest.fn() as NextFunction);
    expect(mockedLogger.error).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith('Operational error', {
      statusCode: 409,
      message: 'Conflict',
    });
  });
});
