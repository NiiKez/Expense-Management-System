/**
 * Unit tests for the Prometheus metrics middleware.
 *
 * The middleware records nothing inline — it registers a `res.on('finish', …)`
 * handler and only observes/increments once the response completes. So we mock
 * `metricsService` to capture the label/observe/inc calls, drive the middleware
 * with a fake req/res, then invoke the captured `finish` callback and assert:
 *   1. the histogram is observed under the NORMALIZED route (`baseUrl+route.path`
 *      when matched, the fixed string `'unmatched'` when `req.route` is absent —
 *      the Prometheus-cardinality guard), and
 *   2. the error counter fires for a 4xx/5xx status but NOT for a 2xx/3xx.
 */
import { Request, Response, NextFunction } from 'express';

// jest.mock factories may only reference outer names prefixed with `mock`.
const mockObserve = jest.fn();
const mockInc = jest.fn();
const mockDurationLabels = jest.fn(() => ({ observe: mockObserve }));
const mockErrorLabels = jest.fn(() => ({ inc: mockInc }));

jest.mock('../../services/metricsService', () => ({
  apiRequestDurationSeconds: { labels: mockDurationLabels },
  apiErrorsTotal: { labels: mockErrorLabels },
}));

import { metricsMiddleware } from '../../middleware/metrics';
import { apiRequestDurationSeconds, apiErrorsTotal } from '../../services/metricsService';

const mockedDuration = apiRequestDurationSeconds as unknown as { labels: jest.Mock };
const mockedErrors = apiErrorsTotal as unknown as { labels: jest.Mock };

interface FakeRes {
  statusCode: number;
  on: jest.Mock;
  finish: () => void;
}

// A res that captures the 'finish' callback so a test can fire it deterministically.
function makeRes(statusCode: number): FakeRes {
  let finishCb: (() => void) | undefined;
  return {
    statusCode,
    on: jest.fn((event: string, handler: () => void) => {
      if (event === 'finish') finishCb = handler;
    }),
    finish: () => finishCb?.(),
  };
}

function makeReq(fields: Record<string, unknown>): Request {
  return { method: 'GET', baseUrl: '', ...fields } as unknown as Request;
}

describe('metricsMiddleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls next() synchronously and defers metric recording to the finish event', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const res = makeRes(200);
    const req = makeReq({ baseUrl: '/api/v1', route: { path: '/expenses' } });

    metricsMiddleware(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith();
    // Guard: nothing is recorded until the response actually finishes.
    expect(mockedDuration.labels).not.toHaveBeenCalled();
    expect(mockObserve).not.toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('observes duration under the normalized baseUrl+route path for a matched route', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const res = makeRes(200);
    const req = makeReq({ method: 'POST', baseUrl: '/api/v1', route: { path: '/expenses/:id' } });

    metricsMiddleware(req, res as unknown as Response, next);
    res.finish();

    // Route label is baseUrl + route.path, NOT the raw URL with the id inlined.
    expect(mockedDuration.labels).toHaveBeenCalledWith('POST', '/api/v1/expenses/:id', '200');
    expect(mockObserve).toHaveBeenCalledTimes(1);
    expect(mockObserve.mock.calls[0][0]).toBeGreaterThanOrEqual(0); // seconds
    // 2xx: no error counter.
    expect(mockedErrors.labels).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  it('collapses an unmatched request (no req.route) to the single "unmatched" series', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const res = makeRes(404);
    // A 404 / attacker probe carries no matched route: the cardinality guard must
    // fold every such distinct URL into ONE label rather than one series per URL.
    const req = makeReq({ method: 'GET', baseUrl: '/api/v1' });

    metricsMiddleware(req, res as unknown as Response, next);
    res.finish();

    expect(mockedDuration.labels).toHaveBeenCalledWith('GET', 'unmatched', '404');
    // 404 (>= 400) → the error counter increments under the same route label.
    expect(mockedErrors.labels).toHaveBeenCalledWith('404', 'unmatched');
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  it('increments the error counter for a 5xx status', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const res = makeRes(500);
    const req = makeReq({ baseUrl: '/api/v1', route: { path: '/reports' } });

    metricsMiddleware(req, res as unknown as Response, next);
    res.finish();

    expect(mockedErrors.labels).toHaveBeenCalledWith('500', '/api/v1/reports');
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  it('does NOT increment the error counter for 2xx/3xx statuses (only >= 400 counts)', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    for (const status of [200, 201, 302, 399]) {
      jest.clearAllMocks();
      const res = makeRes(status);
      const req = makeReq({ baseUrl: '/api/v1', route: { path: '/health' } });

      metricsMiddleware(req, res as unknown as Response, next);
      res.finish();

      // Duration is still observed for every request…
      expect(mockedDuration.labels).toHaveBeenCalledWith('GET', '/api/v1/health', String(status));
      // …but a sub-400 status is never counted as an error.
      expect(mockedErrors.labels).not.toHaveBeenCalled();
      expect(mockInc).not.toHaveBeenCalled();
    }
  });
});
