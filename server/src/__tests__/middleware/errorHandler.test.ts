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

  // Every third-party/middleware HTTP status maps to a fixed, status-appropriate
  // message — the original err.message (which may carry library internals) is never
  // forwarded to the client. Covers the full genericHttpMessage mapping plus the
  // out-of-table default.
  it.each([
    [400, 'Invalid request'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not found'],
    [405, 'Method not allowed'],
    [406, 'Not acceptable'],
    [409, 'Conflict'],
    [413, 'Payload too large'],
    [415, 'Unsupported media type'],
    [429, 'Too many requests'],
    [422, 'Request error'], // 4xx not in the table -> generic default
  ])('maps a %i HTTP error to the generic message %p without echoing err.message', (status, expected) => {
    const err = Object.assign(new Error('leaky internal detail xyz-123'), {
      status,
      type: 'some.library.error',
    });
    const res = mockResponse();

    errorHandler(err, {} as Request, res as Response, jest.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { message: expected, statusCode: status },
    });
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain('leaky internal detail');
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
      requestId: undefined,
    });
  });

  // ── requestId correlation + status-source / >=500 branches ─────────────────
  // The earlier tests all pass `{} as Request`, so `req.id` is undefined and the
  // handler would still pass if it dropped requestId entirely. These pin that the
  // X-Request-Id correlation id is echoed on every branch, and lock the exact
  // status-source semantics.
  describe('requestId propagation and status-source branches', () => {
    const reqWithId = { id: 'req-123' } as unknown as Request;
    const bodyOf = (res: Partial<Response>) =>
      (res.json as jest.Mock).mock.calls[0][0] as { error: { requestId?: string } };

    it('echoes req.id as error.requestId on an AppError response', () => {
      const res = mockResponse();
      errorHandler(new AppError(403, 'Insufficient permissions'), reqWithId, res as Response, jest.fn() as NextFunction);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(bodyOf(res).error.requestId).toBe('req-123');
    });

    it('echoes req.id as error.requestId on a generic 4xx HTTP-error response', () => {
      const err = Object.assign(new Error('parse boom'), { status: 400, type: 'entity.parse.failed' });
      const res = mockResponse();
      errorHandler(err, reqWithId, res as Response, jest.fn() as NextFunction);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(bodyOf(res).error.requestId).toBe('req-123');
    });

    it('echoes req.id as error.requestId on the generic 500 response', () => {
      const res = mockResponse();
      errorHandler(new Error('kaboom'), reqWithId, res as Response, jest.fn() as NextFunction);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(bodyOf(res).error.requestId).toBe('req-123');
    });

    it('honors err.statusCode (not just err.status) for a 4xx and maps to the generic message', () => {
      // An error carrying ONLY statusCode (no `status`) must still be recognised
      // as a 415 and mapped to the fixed message, never echoing err.message.
      const err = Object.assign(new Error('leaky charset detail xyz'), { statusCode: 415 });
      const res = mockResponse();
      errorHandler(err, {} as Request, res as Response, jest.fn() as NextFunction);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ message: 'Unsupported media type', statusCode: 415 }),
        }),
      );
      expect(JSON.stringify(bodyOf(res))).not.toContain('leaky charset detail');
    });

    it('treats a >=500 http-error (status 503) as a generic 500 — never echoing the upstream status/message', () => {
      // getHttpErrorStatus only trusts 4xx; a 5xx from a transitive library must
      // collapse to the opaque 500 path (and be logged as an unhandled error),
      // not be forwarded to the client.
      const err = Object.assign(new Error('upstream 503 gateway detail'), { status: 503, type: 'bad.gateway' });
      const res = mockResponse();
      errorHandler(err, {} as Request, res as Response, jest.fn() as NextFunction);

      expect(res.status).toHaveBeenCalledWith(500);
      const body = JSON.stringify(bodyOf(res));
      expect(body).toContain('Internal server error');
      expect(body).not.toContain('503');
      expect(body).not.toContain('gateway detail');
      // >=500 goes through the unhandled-error logger, not the operational warn.
      expect(mockedLogger.error).toHaveBeenCalledWith('Unhandled error', expect.any(Object));
    });
  });
});
