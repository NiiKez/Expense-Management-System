import { Request, Response, NextFunction } from 'express';
import type { Options } from 'express-rate-limit';
import { SecurityEventType, SecurityOutcome } from '../../types';
import { securityEventModel } from '../../models/securityEvent';
import { rateLimitHandler } from '../../middleware/rateLimitLogging';

jest.mock('../../models/securityEvent', () => ({
  securityEventModel: { record: jest.fn() },
}));

const mockedSecurityEvent = securityEventModel as jest.Mocked<typeof securityEventModel>;

function mockRes(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq(usedOverLimit: number, limit = 100): Request {
  return {
    ip: '203.0.113.5',
    id: 'req-xyz',
    method: 'POST',
    originalUrl: '/api/v1/approvals',
    // used = limit + usedOverLimit; usedOverLimit === 1 is the first blocked request.
    rateLimit: { limit, used: limit + usedOverLimit, remaining: 0, resetTime: undefined },
  } as unknown as Request;
}

const options = { statusCode: 429 } as Options;

describe('rateLimitHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records ONE RATE_LIMIT_EXCEEDED event on the first request over the limit', () => {
    const res = mockRes();

    rateLimitHandler(mockReq(1), res, jest.fn() as NextFunction, options);

    expect(mockedSecurityEvent.record).toHaveBeenCalledTimes(1);
    expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: SecurityEventType.RATE_LIMIT_EXCEEDED,
        outcome: SecurityOutcome.FAILURE,
        ip_address: '203.0.113.5',
        request_id: 'req-xyz',
      }),
    );
  });

  it('does NOT record on subsequent blocked requests in the same window', () => {
    const res = mockRes();

    // used = limit + 2, +3 … — every later blocked request must stay silent so a
    // burst cannot flood the security_events table.
    rateLimitHandler(mockReq(2), res, jest.fn() as NextFunction, options);
    rateLimitHandler(mockReq(50), res, jest.fn() as NextFunction, options);

    expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
  });

  it('always answers with the standard JSON error shape and the request id', () => {
    const res = mockRes();

    rateLimitHandler(mockReq(1), res, jest.fn() as NextFunction, options);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { message: 'Too many requests', statusCode: 429, requestId: 'req-xyz' },
    });
  });

  it('still responds (and does not throw) when rate-limit info is absent', () => {
    const res = mockRes();
    const req = { ip: '203.0.113.5', id: 'req-xyz' } as unknown as Request;

    expect(() => rateLimitHandler(req, res, jest.fn() as NextFunction, options)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
  });
});
