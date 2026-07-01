import nock from 'nock';
import { cacheService } from '../../services/cacheService';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const LOGIN_HOST = 'https://login.microsoftonline.com';
const GRAPH_HOST = 'https://graph.microsoft.com';
const TOKEN_PATH = `/${TENANT_ID}/oauth2/v2.0/token`;
const MANAGER_PATH = '/v1.0/me/manager';
const DIRECT_REPORTS_PATH = '/v1.0/me/directReports/microsoft.graph.user';
const ME_PATH = '/v1.0/me';
const GROUPS_PATH = '/v1.0/me/memberOf/microsoft.graph.group';
const GROUPS_NEXTLINK = `${GRAPH_HOST}${GROUPS_PATH}?$skiptoken=PAGE2`;

type GraphApiModule = typeof import('../../services/graphApi');

async function loadGraphApi(): Promise<GraphApiModule> {
  jest.resetModules();
  process.env.ENTRA_TENANT_ID = TENANT_ID;
  process.env.ENTRA_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
  process.env.ENTRA_CLIENT_SECRET = 'test-secret';
  // Keep the retry backoff effectively instant so the retry tests stay fast.
  process.env.GRAPH_RETRY_BASE_MS = '1';
  process.env.GRAPH_RETRY_MAX_DELAY_MS = '1';

  return import('../../services/graphApi');
}

const DIRECT_REPORTS_NEXTLINK = `${GRAPH_HOST}${DIRECT_REPORTS_PATH}?$skiptoken=PAGE2`;

/** A minimal valid Graph user payload. */
function graphUser(id: string): { id: string; displayName: string; mail: string; userPrincipalName: string } {
  return { id, displayName: id, mail: `${id}@example.com`, userPrincipalName: `${id}@example.com` };
}

/** A Graph user payload that also carries the org attributes. */
function orgUser(id: string): {
  id: string; displayName: string; mail: string; userPrincipalName: string;
  jobTitle: string; department: string; employeeId: string; officeLocation: string;
} {
  return {
    ...graphUser(id),
    jobTitle: `${id}-title`,
    department: `${id}-dept`,
    employeeId: `${id}-emp`,
    officeLocation: `${id}-office`,
  };
}

/** A Graph group payload. */
function graphGroup(id: string): { id: string; displayName: string } {
  return { id, displayName: `${id}-name` };
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

  it('compares Entra object IDs case-insensitively (no wrongful deny on casing drift)', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, {
      value: [graphUser('ENTRA-Target')],
    });

    const result = await graphApiService.isManagerOf(2, 'entra-target', 'user-token', { forceRefresh: true });

    expect(result).toBe(true);
  });
});

describe('result caching', () => {
  it('serves getDirectReports from cache on a second call without forceRefresh', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });

    const first = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });
    expect(first.map((r) => r.id)).toEqual(['entra-1']);

    // No token/Graph mock for the second call: netConnect is disabled, so a cache
    // miss would surface as a connection error instead of silently passing.
    const second = await graphApiService.getDirectReports(42, 'user-token');
    expect(second.map((r) => r.id)).toEqual(['entra-1']);
  });

  it('bypasses a populated cache and re-fetches when forceRefresh is set', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-old')] });

    const first = await graphApiService.getDirectReports(42, 'user-token');
    expect(first.map((r) => r.id)).toEqual(['entra-old']);

    // forceRefresh must skip the cached value and hit Graph again (needs a fresh mock).
    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-new')] });

    const second = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });
    expect(second.map((r) => r.id)).toEqual(['entra-new']);
  });

  it('returns (and caches) an empty array for a genuinely empty team (value: [])', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [] });

    const first = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });
    expect(first).toEqual([]);

    // The empty team is cached: a second non-forceRefresh call needs no new mock.
    const second = await graphApiService.getDirectReports(42, 'user-token');
    expect(second).toEqual([]);
  });

  it('throws (and does not cache) when Graph omits the value array (malformed body)', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, {});

    await expect(graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true }))
      .rejects
      .toThrow(/missing the expected "value" array/);

    // A bogus empty team must NOT have been cached: a follow-up call re-fetches
    // (needs a fresh mock) and now succeeds with the real data.
    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });
    const retried = await graphApiService.getDirectReports(42, 'user-token');
    expect(retried.map((r) => r.id)).toEqual(['entra-1']);
  });
});

describe('OBO token caching', () => {
  it('reuses a cached OBO token (with expires_in) across calls, re-checking membership live', async () => {
    const { graphApiService } = await loadGraphApi();

    // First call: one token exchange (expires_in long enough to cache) + one Graph fetch.
    mockTokenExchange(200, { access_token: 'graph-token', expires_in: 3600 });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });

    await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });

    // Second forceRefresh call: only the Graph fetch is mocked. If the OBO token
    // were not cached, the missing token-exchange mock + disabled netConnect would
    // throw — so this passing proves the token was reused while membership is
    // still re-fetched live.
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-2')] });

    const second = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });
    expect(second.map((r) => r.id)).toEqual(['entra-2']);
  });

  it('does not cache an OBO token whose lifetime is within the safety skew', async () => {
    const { graphApiService } = await loadGraphApi();

    // expires_in (30s) - skew (60s) <= 0 -> not cached, so the next call must
    // perform a fresh exchange (both token mocks are required).
    mockTokenExchange(200, { access_token: 'graph-token', expires_in: 30 });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });
    await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });

    mockTokenExchange(200, { access_token: 'graph-token-2', expires_in: 30 });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });
    await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });

    expect(nock.isDone()).toBe(true);
  });
});

describe('transient-failure retry', () => {
  it('retries the OBO token exchange on a 429 then succeeds', async () => {
    const { graphApiService } = await loadGraphApi();

    nock(LOGIN_HOST).post(TOKEN_PATH).reply(429, {}, { 'retry-after': '0' });
    nock(LOGIN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });

    const reports = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });
    expect(reports.map((r) => r.id)).toEqual(['entra-1']);
  });

  it('retries the Graph GET on a 503 then succeeds', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(503, {});
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });

    const reports = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });
    expect(reports.map((r) => r.id)).toEqual(['entra-1']);
  });

  it('gives up after the attempt budget is exhausted and rethrows the last error', async () => {
    const mod = await loadGraphApi();

    nock(LOGIN_HOST).post(TOKEN_PATH).times(3).reply(503, { error: 'unavailable' });

    const err = await captureRejection(
      mod.graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true }),
    );

    expect((err as { response?: { status?: number } }).response?.status).toBe(503);
    expect(mod.isGraphApiAuthError(err)).toBe(false);
  });

  it('does NOT retry a 4xx (e.g. 401) from the token endpoint', async () => {
    const mod = await loadGraphApi();

    // Only one 401 is mocked; a retry would hit the disabled netConnect and fail
    // differently, so a clean 401 rejection proves no retry was attempted.
    nock(LOGIN_HOST).post(TOKEN_PATH).reply(401, { error: 'unauthorized' });

    const err = await captureRejection(
      mod.graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true }),
    );

    expect((err as { response?: { status?: number } }).response?.status).toBe(401);
  });

  it('retries a no-response network error on the Graph GET then succeeds', async () => {
    // A broken connection with no HTTP response is the isRetryableError "no
    // response = network/timeout" branch (ECONNRESET/ETIMEDOUT/ECONNABORTED). Pin a
    // tiny per-request timeout so the errored/hung socket rejects fast as a
    // no-response error the retry loop must recover from (a real ECONNRESET via
    // nock hangs axios until its default timeout).
    process.env.GRAPH_TIMEOUT_MS = '80';
    try {
      const { graphApiService } = await loadGraphApi();

      mockTokenExchange(200, { access_token: 'graph-token' });
      nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).replyWithError({ code: 'ECONNRESET', message: 'socket hang up' });
      nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });

      const reports = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });
      expect(reports.map((r) => r.id)).toEqual(['entra-1']);
      expect(nock.isDone()).toBe(true);
    } finally {
      delete process.env.GRAPH_TIMEOUT_MS;
    }
  });

  it('honors a Retry-After HTTP-date on a 429 then succeeds', async () => {
    const { graphApiService } = await loadGraphApi();

    // A fixed past HTTP-date exercises parseRetryAfterMs's Date.parse branch; the
    // resulting (clamped) delay is ~0 so the retry lands immediately.
    nock(LOGIN_HOST).post(TOKEN_PATH).reply(429, {}, { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' });
    nock(LOGIN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, { value: [graphUser('entra-1')] });

    const reports = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });
    expect(reports.map((r) => r.id)).toEqual(['entra-1']);
    expect(nock.isDone()).toBe(true);
  });
});

describe('non-retryable 5xx rethrow paths (not misclassified as auth errors)', () => {
  it('rethrows a 500 from getMyOrgProfile without classifying it as a GraphApiAuthError', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    // 500 is NOT in the retryable set (429/502/503/504), so it surfaces immediately.
    nock(GRAPH_HOST).get(ME_PATH).query(true).reply(500, { error: 'server_error' });

    const err = await captureRejection(
      mod.graphApiService.getMyOrgProfile(7, 'user-token', { forceRefresh: true }),
    );

    expect((err as { isAxiosError?: boolean }).isAxiosError).toBe(true);
    expect((err as { response?: { status?: number } }).response?.status).toBe(500);
    expect(mod.isGraphApiAuthError(err)).toBe(false);
  });

  it('rethrows a 500 from getManagerChain without classifying it as a GraphApiAuthError', async () => {
    const mod = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(ME_PATH).query(true).reply(500, { error: 'server_error' });

    const err = await captureRejection(
      mod.graphApiService.getManagerChain(7, 'user-token', { forceRefresh: true }),
    );

    expect((err as { isAxiosError?: boolean }).isAxiosError).toBe(true);
    expect((err as { response?: { status?: number } }).response?.status).toBe(500);
    expect(mod.isGraphApiAuthError(err)).toBe(false);
  });
});

describe('getGraphTokenOBO input validation', () => {
  it('rejects an empty user access token before calling the network', async () => {
    const { graphApiService } = await loadGraphApi();

    // No nock mocks: if it tried to exchange, disabled netConnect would throw a
    // different error than the local validation message.
    await expect(graphApiService.getDirectReports(42, '   ', { forceRefresh: true }))
      .rejects
      .toThrow(/empty user access token/i);
  });
});

describe('validateGraphNextLink (via getDirectReports pagination)', () => {
  async function expectNextLinkRejected(nextLink: string, message: RegExp): Promise<void> {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, {
      value: [],
      '@odata.nextLink': nextLink,
    });

    await expect(graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true }))
      .rejects
      .toThrow(message);
  }

  it('rejects a malformed (non-URL) nextLink', async () => {
    await expectNextLinkRejected('not-a-url', /invalid pagination URL/);
  });

  it('rejects a sibling path that only prefix-matches directReports', async () => {
    await expectNextLinkRejected(
      `${GRAPH_HOST}/v1.0/me/directReportsEVIL?$skiptoken=abc`,
      /unexpected pagination URL/,
    );
  });

  it('rejects a different Graph path', async () => {
    await expectNextLinkRejected(
      `${GRAPH_HOST}/v1.0/users/abc?$skiptoken=abc`,
      /unexpected pagination URL/,
    );
  });

  it('rejects a non-https nextLink', async () => {
    await expectNextLinkRejected(
      'http://graph.microsoft.com/v1.0/me/directReports/microsoft.graph.user?$skiptoken=abc',
      /unexpected pagination URL/,
    );
  });
});

describe('pagination page guard', () => {
  it('throws once the configured maximum page count is exceeded', async () => {
    process.env.GRAPH_MAX_PAGES = '2';
    try {
      const { graphApiService } = await loadGraphApi();

      mockTokenExchange(200, { access_token: 'graph-token' });
      // Two pages, each linking onward; the third would push past the 2-page cap.
      nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, {
        value: [graphUser('entra-1')],
        '@odata.nextLink': DIRECT_REPORTS_NEXTLINK,
      });
      nock(GRAPH_HOST).get(DIRECT_REPORTS_PATH).query(true).reply(200, {
        value: [graphUser('entra-2')],
        '@odata.nextLink': DIRECT_REPORTS_NEXTLINK,
      });

      await expect(graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true }))
        .rejects
        .toThrow(/page limit/i);
    } finally {
      delete process.env.GRAPH_MAX_PAGES;
    }
  });
});

describe('org attributes in $select', () => {
  const ORG_FIELDS = ['jobTitle', 'department', 'employeeId', 'officeLocation'];

  it('requests the org attributes on the /me/manager call', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    let captured: string | undefined;
    nock(GRAPH_HOST)
      .get(MANAGER_PATH)
      .query((q) => {
        captured = q.$select as string;
        return true;
      })
      .reply(200, orgUser('entra-manager'));

    await graphApiService.getManager(7, 'user-token', { forceRefresh: true });

    for (const field of ORG_FIELDS) {
      expect(captured).toContain(field);
    }
  });

  it('requests the org attributes on the /me/directReports call', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    let captured: string | undefined;
    nock(GRAPH_HOST)
      .get(DIRECT_REPORTS_PATH)
      .query((q) => {
        captured = q.$select as string;
        return true;
      })
      .reply(200, { value: [orgUser('entra-1')] });

    const reports = await graphApiService.getDirectReports(42, 'user-token', { forceRefresh: true });

    for (const field of ORG_FIELDS) {
      expect(captured).toContain(field);
    }
    // The org fields flow straight through into the returned GraphUser.
    expect(reports[0]).toMatchObject({
      id: 'entra-1',
      jobTitle: 'entra-1-title',
      department: 'entra-1-dept',
      employeeId: 'entra-1-emp',
      officeLocation: 'entra-1-office',
    });
  });
});

describe('getMyOrgProfile', () => {
  it('returns the caller profile with org attributes and caches it', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    let captured: string | undefined;
    nock(GRAPH_HOST)
      .get(ME_PATH)
      .query((q) => {
        captured = q.$select as string;
        return true;
      })
      .reply(200, orgUser('entra-self'));

    const profile = await graphApiService.getMyOrgProfile(7, 'user-token', { forceRefresh: true });

    expect(captured).toContain('jobTitle');
    expect(profile).toMatchObject({
      id: 'entra-self',
      jobTitle: 'entra-self-title',
      department: 'entra-self-dept',
      employeeId: 'entra-self-emp',
      officeLocation: 'entra-self-office',
    });

    // Second call (no forceRefresh) is served from cache: no new mock + disabled
    // netConnect mean a miss would surface as a connection error.
    const second = await graphApiService.getMyOrgProfile(7, 'user-token');
    expect(second.id).toBe('entra-self');
  });

  it('collapses missing org attributes to null', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    // Graph omits absent directory attributes entirely.
    nock(GRAPH_HOST).get(ME_PATH).query(true).reply(200, graphUser('entra-self'));

    const profile = await graphApiService.getMyOrgProfile(7, 'user-token', { forceRefresh: true });

    expect(profile).toMatchObject({
      id: 'entra-self',
      jobTitle: null,
      department: null,
      employeeId: null,
      officeLocation: null,
    });
  });
});

describe('getManagerChain', () => {
  it('flattens a nested manager chain nearest-first', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(ME_PATH).query(true).reply(200, {
      ...orgUser('entra-self'),
      manager: {
        ...orgUser('entra-m1'),
        manager: {
          ...orgUser('entra-m2'),
          manager: null,
        },
      },
    });

    const chain = await graphApiService.getManagerChain(7, 'user-token', { forceRefresh: true });

    expect(chain.map((m) => m.id)).toEqual(['entra-m1', 'entra-m2']);
    // Self is excluded; org attributes are carried per level.
    expect(chain[0]).toMatchObject({ id: 'entra-m1', jobTitle: 'entra-m1-title', department: 'entra-m1-dept' });
  });

  it('returns an empty array when the caller has no manager', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(ME_PATH).query(true).reply(200, orgUser('entra-self'));

    const chain = await graphApiService.getManagerChain(7, 'user-token', { forceRefresh: true });

    expect(chain).toEqual([]);
  });

  it('normalizes missing org attributes on each level to null', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(ME_PATH).query(true).reply(200, {
      ...graphUser('entra-self'),
      manager: { ...graphUser('entra-m1'), manager: null },
    });

    const chain = await graphApiService.getManagerChain(7, 'user-token', { forceRefresh: true });

    expect(chain[0]).toMatchObject({
      id: 'entra-m1',
      jobTitle: null,
      department: null,
      employeeId: null,
      officeLocation: null,
    });
  });

  it('stops walking past the defensive depth cap', async () => {
    process.env.GRAPH_MAX_CHAIN_DEPTH = '2';
    try {
      const { graphApiService } = await loadGraphApi();

      mockTokenExchange(200, { access_token: 'graph-token' });
      nock(GRAPH_HOST).get(ME_PATH).query(true).reply(200, {
        ...orgUser('entra-self'),
        manager: {
          ...orgUser('entra-m1'),
          manager: {
            ...orgUser('entra-m2'),
            manager: {
              ...orgUser('entra-m3'),
              manager: null,
            },
          },
        },
      });

      const chain = await graphApiService.getManagerChain(7, 'user-token', { forceRefresh: true });

      // Cap of 2 → only the two nearest managers are walked; the third is dropped.
      expect(chain.map((m) => m.id)).toEqual(['entra-m1', 'entra-m2']);
    } finally {
      delete process.env.GRAPH_MAX_CHAIN_DEPTH;
    }
  });

  it('serves a cached chain on a second call without forceRefresh', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(ME_PATH).query(true).reply(200, {
      ...orgUser('entra-self'),
      manager: { ...orgUser('entra-m1'), manager: null },
    });

    const first = await graphApiService.getManagerChain(7, 'user-token', { forceRefresh: true });
    expect(first.map((m) => m.id)).toEqual(['entra-m1']);

    // No new mock: a cache miss would hit the disabled netConnect and throw.
    const second = await graphApiService.getManagerChain(7, 'user-token');
    expect(second.map((m) => m.id)).toEqual(['entra-m1']);
  });
});

describe('getGroupMemberships', () => {
  it('paginates across @odata.nextLink pages and caches the result', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(GROUPS_PATH).query(true).reply(200, {
      value: [graphGroup('group-1')],
      '@odata.nextLink': GROUPS_NEXTLINK,
    });
    nock(GRAPH_HOST).get(GROUPS_PATH).query(true).reply(200, {
      value: [graphGroup('group-2')],
    });

    const groups = await graphApiService.getGroupMemberships(11, 'user-token', { forceRefresh: true });

    expect(groups).toEqual([
      { id: 'group-1', displayName: 'group-1-name' },
      { id: 'group-2', displayName: 'group-2-name' },
    ]);

    // Second call (no forceRefresh) is served from cache: no new mock required.
    const second = await graphApiService.getGroupMemberships(11, 'user-token');
    expect(second.map((g) => g.id)).toEqual(['group-1', 'group-2']);
  });

  it('normalizes a missing group displayName to null', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(GROUPS_PATH).query(true).reply(200, {
      value: [{ id: 'group-1' }],
    });

    const groups = await graphApiService.getGroupMemberships(11, 'user-token', { forceRefresh: true });

    expect(groups).toEqual([{ id: 'group-1', displayName: null }]);
  });

  it('rejects a sibling path that only prefix-matches memberOf', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(GROUPS_PATH).query(true).reply(200, {
      value: [],
      '@odata.nextLink': `${GRAPH_HOST}/v1.0/me/memberOfEVIL?$skiptoken=abc`,
    });

    await expect(graphApiService.getGroupMemberships(11, 'user-token', { forceRefresh: true }))
      .rejects
      .toThrow(/unexpected pagination URL/);
  });

  it('rejects a nextLink on a non-Graph host', async () => {
    const { graphApiService } = await loadGraphApi();

    mockTokenExchange(200, { access_token: 'graph-token' });
    nock(GRAPH_HOST).get(GROUPS_PATH).query(true).reply(200, {
      value: [],
      '@odata.nextLink': 'https://example.test/v1.0/me/memberOf/microsoft.graph.group?$skiptoken=abc',
    });

    await expect(graphApiService.getGroupMemberships(11, 'user-token', { forceRefresh: true }))
      .rejects
      .toThrow(/unexpected pagination URL/);
  });

  it('throws once the configured group page cap is exceeded', async () => {
    process.env.GRAPH_MAX_GROUP_PAGES = '2';
    try {
      const { graphApiService } = await loadGraphApi();

      mockTokenExchange(200, { access_token: 'graph-token' });
      nock(GRAPH_HOST).get(GROUPS_PATH).query(true).reply(200, {
        value: [graphGroup('group-1')],
        '@odata.nextLink': GROUPS_NEXTLINK,
      });
      nock(GRAPH_HOST).get(GROUPS_PATH).query(true).reply(200, {
        value: [graphGroup('group-2')],
        '@odata.nextLink': GROUPS_NEXTLINK,
      });

      await expect(graphApiService.getGroupMemberships(11, 'user-token', { forceRefresh: true }))
        .rejects
        .toThrow(/page limit/i);
    } finally {
      delete process.env.GRAPH_MAX_GROUP_PAGES;
    }
  });
});
