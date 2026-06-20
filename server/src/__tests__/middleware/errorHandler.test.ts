import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../middleware/errorHandler';

function mockResponse(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
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
});
