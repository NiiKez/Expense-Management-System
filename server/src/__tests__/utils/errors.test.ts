import { AppError, notFound, unauthorized, forbidden, badRequest, conflict } from '../../utils/errors';

describe('AppError', () => {
  // ── Constructor ──────────────────────────────────────────────

  it('should create an error with statusCode and message', () => {
    const error = new AppError(400, 'Bad request');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Bad request');
    expect(error.isOperational).toBe(true);
  });

  it('should default isOperational to true', () => {
    const error = new AppError(500, 'Something broke');

    expect(error.isOperational).toBe(true);
  });

  it('should allow isOperational to be set to false', () => {
    const error = new AppError(500, 'Fatal', false);

    expect(error.isOperational).toBe(false);
  });

  it('should have a proper stack trace', () => {
    const error = new AppError(500, 'Test');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('errors.test.ts');
  });

  it('should preserve prototype chain (instanceof works)', () => {
    const error = new AppError(404, 'Not found');

    expect(error instanceof AppError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });

  it('should have name set to AppError via constructor', () => {
    const error = new AppError(500, 'Test');

    // Error.name defaults to constructor name
    expect(error.constructor.name).toBe('AppError');
  });
});

// ── Factory functions ────────────────────────────────────────────

describe('notFound', () => {
  it('should create a 404 error with default message', () => {
    const error = notFound();

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Resource not found');
    expect(error.isOperational).toBe(true);
  });

  it('should create a 404 error with custom resource name', () => {
    const error = notFound('Expense');

    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Expense not found');
  });
});

describe('unauthorized', () => {
  it('should create a 401 error with default message', () => {
    const error = unauthorized();

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Authentication required');
  });

  it('should create a 401 error with custom message', () => {
    const error = unauthorized('Token expired');

    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Token expired');
  });
});

describe('forbidden', () => {
  it('should create a 403 error with default message', () => {
    const error = forbidden();

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('Insufficient permissions');
  });

  it('should create a 403 error with custom message', () => {
    const error = forbidden('You can only update your own expenses');

    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('You can only update your own expenses');
  });
});

describe('badRequest', () => {
  it('should create a 400 error with the given message', () => {
    const error = badRequest('Invalid expense ID');

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Invalid expense ID');
  });
});

describe('conflict', () => {
  it('should create a 409 error with the given message', () => {
    const error = conflict('Only pending expenses can be updated');

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe('Only pending expenses can be updated');
  });
});

// ── All factories produce operational errors ─────────────────────

describe('factory functions — shared behavior', () => {
  it.each([
    ['notFound', notFound()],
    ['unauthorized', unauthorized()],
    ['forbidden', forbidden()],
    ['badRequest', badRequest('msg')],
    ['conflict', conflict('msg')],
  ])('%s should produce an operational AppError', (_name, error) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.isOperational).toBe(true);
    expect(error.stack).toBeDefined();
  });
});
