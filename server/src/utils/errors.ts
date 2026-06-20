export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Preserve proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);

    // Set prototype explicitly (TS class inheritance with built-ins)
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// Convenience factory functions
export const notFound = (resource = 'Resource') =>
  new AppError(404, `${resource} not found`);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, message);

export const forbidden = (message = 'Insufficient permissions') =>
  new AppError(403, message);

export const badRequest = (message: string) =>
  new AppError(400, message);

export const conflict = (message: string) =>
  new AppError(409, message);
