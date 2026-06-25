import nock from 'nock';
import { cacheService } from '../../services/cacheService';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const LOGIN_HOST = 'https://login.microsoftonline.com';
const GRAPH_HOST = 'https://graph.microsoft.com';
const TOKEN_PATH = `/${TENANT_ID}/oauth2/v2.0/token`;
const MANAGER_PATH = '/v1.0/me/manager';
const DIRECT_REPORTS_PATH = '/v1.0/me/directReports/microsoft.graph.user';

type GraphApiModule = typeof import('../../services/graphApi');

async function loadGraphApi(): Promise<GraphApiModule> {
  jest.resetModules();
  process.env.ENTRA_TENANT_ID = TENANT_ID;
  process.env.ENTRA_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
  process.env.ENTRA_CLIENT_SECRET = 'test-secret';

  return import('../../services/graphApi');
}

/** Mock the OBO token exchange endpoint (login.microsoftonline.com). */
function mockTokenExchange(status: number, body: unknown): nock.Scope {
  return nock(LOGIN_HOST).post(TOKEN_PATH).reply(status, body as nock.Body);
}

/** Run a promise we expect to reject and return the rejection value. */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  let threw = false;
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    threw = true;
    caught = err;
  }
  expect(threw).toBe(true);
  return caught;
}

beforeEach(() => {
  nock.cleanAll();
  nock.disableNetConnect();
  cacheService.flushAll();
});

afterAll(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('graphApiService pagination safety', () => {
  it('rejects Graph nextLink URLs outside Microsoft Graph direct reports', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });

    nock(GRAPH_HOST)
      .get(DIRECT_REPORTS_PATH)
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
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });

    nock(GRAPH_HOST)
      .get(DIRECT_REPORTS_PATH)
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
      .get(DIRECT_REPORTS_PATH)
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

describe('getGraphTokenOBO consent-error mapping (RBAC load-bearing)', () => {
  // These exercise the OBO token exchange via getDirectReports (the path
  // approvalController/getPendingApprovals actually drives). A consent failure
  // MUST surface as GraphApiAuthError{reason:'consent_required'} so the
  // controller's `isGraphApiAuthError(err) && err.reason === 'consent_required'`
  // branch routes to the consent-specific database fallback. A regression here
  // (mis-classifying consent, or losing the reason) fails these tests.

  it('maps an invalid_grant + suberror=consent_required (status 400) to GraphApiAuthError', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(400, {
      error: 'invalid_grant',
      suberror: 'consent_required',
      error_description: 'AADSTS65001: The user or administrator has not consented.',
    });

    const err = await captureRejection(
      mod.graphApiService.getDirectReports(7, 'user-token', { forceRefresh: true }),
    );

    expect(mod.isGraphApiAuthError(err)).toBe(true);
    expect(err).toBeInstanceOf(mod.GraphApiAuthError);
    expect((err as InstanceType<typeof mod.GraphApiAuthError>).reason).toBe('consent_required');
  });

  it('maps an invalid_grant + error_codes containing 65001 (no suberror) to GraphApiAuthError', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(400, {
      error: 'invalid_grant',
      error_codes: [65001],
      error_description: 'AADSTS65001: consent required.',
    });

    const err = await captureRejection(
      mod.graphApiService.getManager(7, 'user-token', { forceRefresh: true }),
    );

    expect(mod.isGraphApiAuthError(err)).toBe(true);
    expect((err as InstanceType<typeof mod.GraphApiAuthError>).reason).toBe('consent_required');
  });

  it('maps when BOTH suberror and error_codes signal consent', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(400, {
      error: 'invalid_grant',
      suberror: 'consent_required',
      error_codes: [65001, 50058],
    });

    const err = await captureRejection(
      mod.graphApiService.getDirectReports(7, 'user-token', { forceRefresh: true }),
    );

    expect(mod.isGraphApiAuthError(err)).toBe(true);
    expect((err as InstanceType<typeof mod.GraphApiAuthError>).reason).toBe('consent_required');
  });

  it('does NOT map a different suberror / unrelated error_codes (still invalid_grant, 400)', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(400, {
      error: 'invalid_grant',
      suberror: 'bad_token',
      error_codes: [70000],
    });

    const err = await captureRejection(
      mod.graphApiService.getDirectReports(7, 'user-token', { forceRefresh: true }),
    );

    expect(mod.isGraphApiAuthError(err)).toBe(false);
    expect((err as { isAxiosError?: boolean }).isAxiosError).toBe(true);
  });

  it('does NOT map when the status is not 400 even if the consent suberror is present', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(401, {
      error: 'invalid_grant',
      suberror: 'consent_required',
    });

    const err = await captureRejection(
      mod.graphApiService.getDirectReports(7, 'user-token', { forceRefresh: true }),
    );

    expect(mod.isGraphApiAuthError(err)).toBe(false);
    expect((err as { response?: { status?: number } }).response?.status).toBe(401);
  });

  it('does NOT map when error is not invalid_grant (e.g. interaction_required) at 400', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(400, {
      error: 'interaction_required',
      suberror: 'consent_required',
      error_codes: [65001],
    });

    const err = await captureRejection(
      mod.graphApiService.getDirectReports(7, 'user-token', { forceRefresh: true }),
    );

    expect(mod.isGraphApiAuthError(err)).toBe(false);
  });

  it('treats a non-axios failure (token response missing access_token) as non-consent', async () => {
    const mod = await loadGraphApi();

    // 200 but no access_token -> getGraphTokenOBO throws a plain Error, which
    // isConsentRequiredError must reject (it is not an axios error).
    mockTokenExchange(200, { token_type: 'Bearer' });

    const err = await captureRejection(
      mod.graphApiService.getManager(7, 'user-token', { forceRefresh: true }),
    );

    expect(mod.isGraphApiAuthError(err)).toBe(false);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/did not include an access token/i);
  });
});

describe('getManager', () => {
  const manager = {
    id: 'entra-manager',
    displayName: 'Manager Person',
    mail: 'manager@example.com',
    userPrincipalName: 'manager@example.com',
  };

  it('returns the parsed manager profile on the OBO success path', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(MANAGER_PATH).query(true).reply(200, manager);

    const result = await graphApiService.getManager(7, 'user-token', { forceRefresh: true });

    expect(result).toEqual(manager);
  });

  it('returns null when Graph reports no manager assigned (404) and caches the null', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(MANAGER_PATH).query(true).reply(404, {
      error: { code: 'Request_ResourceNotFound', message: 'No manager.' },
    });

    const first = await graphApiService.getManager(7, 'user-token', { forceRefresh: true });
    expect(first).toBeNull();

    // Second call (no forceRefresh) must be served from cache: no further token
    // exchange or Graph request is mocked, and netConnect is disabled, so a cache
    // miss would surface as a connection error rather than silently passing.
    const second = await graphApiService.getManager(7, 'user-token');
    expect(second).toBeNull();
  });

  it('rethrows a non-404 Graph error rather than masking it as "no manager"', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(MANAGER_PATH).query(true).reply(500, { error: 'server_error' });

    const err = await captureRejection(
      mod.graphApiService.getManager(7, 'user-token', { forceRefresh: true }),
    );

    expect((err as { isAxiosError?: boolean }).isAxiosError).toBe(true);
    expect((err as { response?: { status?: number } }).response?.status).toBe(500);
    expect(mod.isGraphApiAuthError(err)).toBe(false);
  });
});

describe('isManagerOf', () => {
  function mockDirectReports(reports: Array<{ id: string }>): void {
    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, {
      value: reports.map((r) => ({
        id: r.id,
        displayName: r.id,
        mail: `${r.id}@example.com`,
        userPrincipalName: `${r.id}@example.com`,
      })),
    });
  }

  it('returns true when the subordinate appears among the direct reports', async () => {
    const { graphApiService } = await loadGraphApi();

    mockDirectReports([{ id: 'entra-other' }, { id: 'entra-target' }]);

    const result = await graphApiService.isManagerOf(2, 'entra-target', 'user-token', { forceRefresh: true });

    expect(result).toBe(true);
  });

  it('returns false when the subordinate is not among the direct reports', async () => {
    const { graphApiService } = await loadGraphApi();

    mockDirectReports([{ id: 'entra-other' }, { id: 'entra-someone-else' }]);

    const result = await graphApiService.isManagerOf(2, 'entra-target', 'user-token', { forceRefresh: true });

    expect(result).toBe(false);
  });
});
