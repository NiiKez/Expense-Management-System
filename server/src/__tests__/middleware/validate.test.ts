import { Request, Response, NextFunction } from 'express';

// validate.ts calls safeUnlinkReceipt(req.file.path) on ANY failure path so a
// rejected request never orphans its just-saved upload. Stub it so we can assert
// the cleanup without touching disk. It returns a promise (validate chains .catch).
jest.mock('../../utils/receiptFiles', () => ({
  __esModule: true,
  safeUnlinkReceipt: jest.fn(() => Promise.resolve()),
}));

import { validate } from '../../middleware/validate';
import { createExpenseSchema, updateExpenseSchema } from '../../validations/expenseSchema';
import { MIN_EXPENSE_AMOUNT, MAX_EXPENSE_AMOUNT } from '../../utils/constants';
import { safeUnlinkReceipt } from '../../utils/receiptFiles';

const mockedUnlink = safeUnlinkReceipt as jest.MockedFunction<typeof safeUnlinkReceipt>;

// Helper to create mock req/res/next
const mockRequest = (body: unknown): Partial<Request> => ({ body });

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Valid base payload for createExpenseSchema
const validCreatePayload = {
  title: 'Office supplies',
  amount: 49.99,
  category: 'SUPPLIES',
  expense_date: '2026-03-20',
};

describe('validate middleware', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
  });

  // ── createExpenseSchema: passing cases ───────────────────────

  describe('createExpenseSchema — valid inputs', () => {
    it('should call next() with no error for a valid payload', () => {
      const req = mockRequest({ ...validCreatePayload });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should accept optional description', () => {
      const req = mockRequest({ ...validCreatePayload, description: 'Pens and paper' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.description).toBe('Pens and paper');
    });

    it('should accept null description', () => {
      const req = mockRequest({ ...validCreatePayload, description: null });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.description).toBeNull();
    });

    it('should default currency to USD when not provided', () => {
      const req = mockRequest({ ...validCreatePayload });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.currency).toBe('USD');
    });

    it('should uppercase a lowercase currency code', () => {
      const req = mockRequest({ ...validCreatePayload, currency: 'eur' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.currency).toBe('EUR');
    });

    it('should accept the minimum allowed amount', () => {
      const req = mockRequest({ ...validCreatePayload, amount: MIN_EXPENSE_AMOUNT });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should accept the maximum allowed amount', () => {
      const req = mockRequest({ ...validCreatePayload, amount: MAX_EXPENSE_AMOUNT });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
    });

    it.each([
      'TRAVEL', 'MEALS', 'SUPPLIES', 'EQUIPMENT', 'SOFTWARE', 'TRAINING', 'OTHER',
    ])('should accept category %s', (category) => {
      const req = mockRequest({ ...validCreatePayload, category });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject unknown fields in the body (.strict)', () => {
      const req = mockRequest({ ...validCreatePayload, hacker: 'drop table' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      // .strict() rejects unknown keys outright rather than silently stripping
      // them, so a stray/privileged field is a 400 and never reaches the handler.
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── createExpenseSchema: rejection cases ─────────────────────

  describe('createExpenseSchema — invalid inputs', () => {
    const expectValidationError = (res: Partial<Response>) => {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: 'Validation failed',
            statusCode: 400,
            details: expect.any(Array),
          }),
        }),
      );
    };

    it('should reject when title is missing', () => {
      const { title: _, ...noTitle } = validCreatePayload;
      const req = mockRequest(noTitle);
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when title is empty string', () => {
      const req = mockRequest({ ...validCreatePayload, title: '' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when title exceeds 255 characters', () => {
      const req = mockRequest({ ...validCreatePayload, title: 'x'.repeat(256) });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when amount is missing', () => {
      const { amount: _, ...noAmount } = validCreatePayload;
      const req = mockRequest(noAmount);
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when amount is zero', () => {
      const req = mockRequest({ ...validCreatePayload, amount: 0 });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when amount is negative', () => {
      const req = mockRequest({ ...validCreatePayload, amount: -10 });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when amount exceeds the maximum', () => {
      const req = mockRequest({ ...validCreatePayload, amount: MAX_EXPENSE_AMOUNT + 0.01 });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when amount is a string', () => {
      const req = mockRequest({ ...validCreatePayload, amount: 'fifty' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when category is missing', () => {
      const { category: _, ...noCategory } = validCreatePayload;
      const req = mockRequest(noCategory);
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject an invalid category', () => {
      const req = mockRequest({ ...validCreatePayload, category: 'FOOD' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject when expense_date is missing', () => {
      const { expense_date: _, ...noDate } = validCreatePayload;
      const req = mockRequest(noDate);
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject an improperly formatted expense_date', () => {
      const req = mockRequest({ ...validCreatePayload, expense_date: '03/20/2026' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject a currency code that is not 3 characters', () => {
      const req = mockRequest({ ...validCreatePayload, currency: 'US' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
    });

    it('should reject a completely empty body', () => {
      const req = mockRequest({});
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expectValidationError(res);
      // Should report multiple field errors
      const jsonCall = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.error.details.length).toBeGreaterThan(1);
    });
  });

  // ── updateExpenseSchema ──────────────────────────────────────

  describe('updateExpenseSchema — valid inputs', () => {
    it('should accept a partial update with only title', () => {
      const req = mockRequest({ title: 'Updated title' });
      const res = mockResponse();

      validate(updateExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should accept a partial update with only amount', () => {
      const req = mockRequest({ amount: 100 });
      const res = mockResponse();

      validate(updateExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject an empty body (must contain at least one field)', () => {
      const req = mockRequest({});
      const res = mockResponse();

      validate(updateExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should accept all fields at once', () => {
      const req = mockRequest({
        title: 'New title',
        description: 'New desc',
        amount: 200,
        currency: 'gbp',
        category: 'TRAVEL',
        expense_date: '2026-01-15',
      });
      const res = mockResponse();

      validate(updateExpenseSchema)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.currency).toBe('GBP');
    });
  });

  describe('updateExpenseSchema — invalid inputs', () => {
    it('should reject an empty title string', () => {
      const req = mockRequest({ title: '' });
      const res = mockResponse();

      validate(updateExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject a negative amount', () => {
      const req = mockRequest({ amount: -5 });
      const res = mockResponse();

      validate(updateExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject an invalid category', () => {
      const req = mockRequest({ category: 'INVALID' });
      const res = mockResponse();

      validate(updateExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject a bad date format', () => {
      const req = mockRequest({ expense_date: '2026/01/15' });
      const res = mockResponse();

      validate(updateExpenseSchema)(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── Error details structure ──────────────────────────────────

  describe('error response details', () => {
    it('should include field name and message in each detail entry', () => {
      const req = mockRequest({ amount: 'not-a-number', category: 'BAD' });
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      const jsonCall = (res.json as jest.Mock).mock.calls[0][0];
      const details = jsonCall.error.details;

      expect(details.length).toBeGreaterThanOrEqual(2);
      for (const detail of details) {
        expect(detail).toHaveProperty('field');
        expect(detail).toHaveProperty('message');
        expect(typeof detail.field).toBe('string');
        expect(typeof detail.message).toBe('string');
      }
    });
  });

  // ── Non-Zod errors are forwarded to next() ──────────────────

  describe('non-Zod errors', () => {
    it('should forward unexpected errors to next()', () => {
      const thrownError = new Error('unexpected');
      const faultySchema = {
        parse: () => { throw thrownError; },
      };
      const req = mockRequest({});
      const res = mockResponse();

      validate(faultySchema as never)(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(thrownError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ── Orphaned-receipt cleanup on validation failure ───────────────────────────
  describe('uploaded-receipt cleanup on failure', () => {
    beforeEach(() => mockedUnlink.mockClear());

    it('unlinks the just-saved receipt when the body fails Zod validation', () => {
      const req = { body: {}, file: { path: '/tmp/receipts/orphan.png' } } as unknown as Request;
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
      expect(mockedUnlink).toHaveBeenCalledWith('/tmp/receipts/orphan.png');
    });

    it('unlinks the just-saved receipt on a non-Zod (unexpected) failure too', () => {
      const thrown = new Error('boom');
      const faultySchema = { parse: () => { throw thrown; } };
      const req = { body: {}, file: { path: '/tmp/receipts/orphan2.pdf' } } as unknown as Request;
      const res = mockResponse();

      validate(faultySchema as never)(req as Request, res as Response, next);

      expect(mockedUnlink).toHaveBeenCalledWith('/tmp/receipts/orphan2.pdf');
      expect(next).toHaveBeenCalledWith(thrown);
    });

    it('does NOT unlink when the failing request carried no uploaded file', () => {
      // Control: cleanup is conditional on req.file, so a bodiless failure must
      // not call unlink at all (otherwise the guard is meaningless).
      const req = mockRequest({});
      const res = mockResponse();

      validate(createExpenseSchema)(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockedUnlink).not.toHaveBeenCalled();
    });
  });
});
