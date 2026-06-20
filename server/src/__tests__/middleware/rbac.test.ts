import { Request, Response, NextFunction } from 'express';
import { authorize } from '../../middleware/rbac';
import { Role } from '../../types';
import { AppError } from '../../utils/errors';

// Helper to create a mock request with optional user
const mockRequest = (user?: Request['user']): Partial<Request> => ({
  user,
});

const mockResponse = (): Partial<Response> => ({});

describe('authorize middleware', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
  });

  // ── No user (unauthenticated) ──────────────────────────────

  it('should return 401 when req.user is undefined', () => {
    const req = mockRequest(undefined);
    const res = mockResponse();

    authorize([Role.EMPLOYEE])(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as unknown as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Authentication required');
  });

  // ── Authorized: single role ────────────────────────────────

  it('should call next() with no error when user has the required role', () => {
    const req = mockRequest({
      id: 1,
      role: Role.MANAGER,
      email: 'mgr@test.com',
      display_name: 'Manager',
    });
    const res = mockResponse();

    authorize([Role.MANAGER])(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  // ── Authorized: multiple allowed roles ─────────────────────

  it('should call next() when user role is one of several allowed roles', () => {
    const req = mockRequest({
      id: 2,
      role: Role.ADMIN,
      email: 'admin@test.com',
      display_name: 'Admin',
    });
    const res = mockResponse();

    authorize([Role.MANAGER, Role.ADMIN])(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  // ── Forbidden: role not in allowed list ────────────────────

  it('should return 403 when user role is not in the allowed list', () => {
    const req = mockRequest({
      id: 3,
      role: Role.EMPLOYEE,
      email: 'emp@test.com',
      display_name: 'Employee',
    });
    const res = mockResponse();

    authorize([Role.MANAGER, Role.ADMIN])(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as unknown as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('Insufficient permissions');
  });

  // ── Each role can be individually authorized ───────────────

  it.each([
    [Role.EMPLOYEE, [Role.EMPLOYEE]],
    [Role.MANAGER, [Role.MANAGER]],
    [Role.ADMIN, [Role.ADMIN]],
  ])('should allow %s when allowed roles include %s', (role, allowedRoles) => {
    const req = mockRequest({
      id: 1,
      role,
      email: 'user@test.com',
      display_name: 'User',
    });
    const res = mockResponse();

    authorize(allowedRoles)(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  // ── Each role can be individually denied ───────────────────

  it.each([
    [Role.EMPLOYEE, [Role.MANAGER, Role.ADMIN]],
    [Role.MANAGER, [Role.EMPLOYEE, Role.ADMIN]],
    [Role.ADMIN, [Role.EMPLOYEE, Role.MANAGER]],
  ])('should deny %s when allowed roles are %s', (role, allowedRoles) => {
    const req = mockRequest({
      id: 1,
      role,
      email: 'user@test.com',
      display_name: 'User',
    });
    const res = mockResponse();

    authorize(allowedRoles)(req as Request, res as Response, next);

    const error = next.mock.calls[0][0] as unknown as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
  });

  // ── Empty allowed roles list denies everyone ───────────────

  it('should return 403 when allowed roles list is empty', () => {
    const req = mockRequest({
      id: 1,
      role: Role.ADMIN,
      email: 'admin@test.com',
      display_name: 'Admin',
    });
    const res = mockResponse();

    authorize([])(req as Request, res as Response, next);

    const error = next.mock.calls[0][0] as unknown as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
  });
});
