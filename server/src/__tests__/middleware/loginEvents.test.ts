import { Request } from 'express';
import { SecurityEventType, SecurityOutcome } from '../../types';
import { securityEventModel } from '../../models/securityEvent';
import { recordLoginSuccess, __resetLoginDedupe } from '../../middleware/loginEvents';

jest.mock('../../models/securityEvent', () => ({
  securityEventModel: { record: jest.fn() },
}));

const mockedSecurityEvent = securityEventModel as jest.Mocked<typeof securityEventModel>;

const nowSec = () => Math.floor(Date.now() / 1000);
const req = { ip: '198.51.100.7', id: 'req-login' } as unknown as Request;

describe('recordLoginSuccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetLoginDedupe();
  });

  it('records ONE LOGIN_SUCCESS for a freshly-issued token, carrying oid/user/role/ip/request-id', () => {
    recordLoginSuccess(req, { oid: 'oid-abc', iat: nowSec(), userId: 7, role: 'ADMIN' });

    expect(mockedSecurityEvent.record).toHaveBeenCalledTimes(1);
    expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: SecurityEventType.LOGIN_SUCCESS,
        outcome: SecurityOutcome.SUCCESS,
        user_id: 7,
        entra_oid: 'oid-abc',
        role: 'ADMIN',
        ip_address: '198.51.100.7',
        request_id: 'req-login',
      }),
    );
  });

  it('de-duplicates the same token (oid + iat) — the SPA fans out many requests per token', () => {
    const iat = nowSec();
    recordLoginSuccess(req, { oid: 'oid-abc', iat, userId: 7, role: 'ADMIN' });
    recordLoginSuccess(req, { oid: 'oid-abc', iat, userId: 7, role: 'ADMIN' });
    recordLoginSuccess(req, { oid: 'oid-abc', iat, userId: 7, role: 'ADMIN' });

    expect(mockedSecurityEvent.record).toHaveBeenCalledTimes(1);
  });

  it('records again for a NEW token (different iat) — e.g. a silent refresh or re-login', () => {
    const iat = nowSec();
    recordLoginSuccess(req, { oid: 'oid-abc', iat, userId: 7, role: 'ADMIN' });
    recordLoginSuccess(req, { oid: 'oid-abc', iat: iat + 1, userId: 7, role: 'ADMIN' });

    expect(mockedSecurityEvent.record).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale token (old iat) — a routine mid-session request is not a sign-in', () => {
    recordLoginSuccess(req, { oid: 'oid-abc', iat: nowSec() - 3600, userId: 7, role: 'ADMIN' });

    expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
  });

  it('does nothing when the token has no iat claim', () => {
    recordLoginSuccess(req, { oid: 'oid-abc', userId: 7, role: 'ADMIN' });

    expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
  });
});
