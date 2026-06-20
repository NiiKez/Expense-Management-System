import nock from 'nock';
import { cacheService } from '../../services/cacheService';

async function loadGraphApiService() {
  jest.resetModules();
  process.env.ENTRA_TENANT_ID = '00000000-0000-0000-0000-000000000000';
  process.env.ENTRA_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
  process.env.ENTRA_CLIENT_SECRET = 'test-secret';

  const mod = await import('../../services/graphApi');
  return mod.graphApiService;
}

describe('graphApiService pagination safety', () => {
  beforeEach(() => {
    nock.cleanAll();
    cacheService.flushAll();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  it('rejects Graph nextLink URLs outside Microsoft Graph direct reports', async () => {
    const graphApiService = await loadGraphApiService();

    nock('https://login.microsoftonline.com')
      .post('/00000000-0000-0000-0000-000000000000/oauth2/v2.0/token')
      .reply(200, { access_token: 'graph-token' });

    nock('https://graph.microsoft.com')
      .get('/v1.0/me/directReports/microsoft.graph.user')
      .query(true)
      .reply(200, {
        value: [],
        '@odata.nextLink': 'https://example.test/v1.0/me/directReports/microsoft.graph.user?$skiptoken=abc',
      });

    await expect(graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true }))
      .rejects
      .toThrow('unexpected pagination URL');
  });

  it('follows valid Microsoft Graph direct reports nextLink URLs', async () => {
    const graphApiService = await loadGraphApiService();

    nock('https://login.microsoftonline.com')
      .post('/00000000-0000-0000-0000-000000000000/oauth2/v2.0/token')
      .reply(200, { access_token: 'graph-token' });

    nock('https://graph.microsoft.com')
      .get('/v1.0/me/directReports/microsoft.graph.user')
      .query(true)
      .reply(200, {
        value: [{
          id: 'entra-1',
          displayName: 'Employee One',
          mail: 'one@example.com',
          userPrincipalName: 'one@example.com',
        }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/directReports/microsoft.graph.user?$skiptoken=abc',
      })
      .get('/v1.0/me/directReports/microsoft.graph.user')
      .query(true)
      .reply(200, {
        value: [{
          id: 'entra-2',
          displayName: 'Employee Two',
          mail: 'two@example.com',
          userPrincipalName: 'two@example.com',
        }],
      });

    const reports = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });

    expect(reports.map((report) => report.id)).toEqual(['entra-1', 'entra-2']);
  });
});
