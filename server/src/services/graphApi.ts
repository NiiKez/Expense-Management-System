import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { createHash } from 'crypto';
import { entraConfig } from '../config/entra';
import { cacheService } from './cacheService';
import logger from '../config/logger';
import { summarizeHttpError } from '../utils/logSanitizer';
import { intFromEnv } from '../utils/env';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_HOSTNAME = 'graph.microsoft.com';
// Anchored path prefix for /me/directReports pagination URLs (see validateGraphNextLink).
const DIRECT_REPORTS_PATH = '/v1.0/me/directReports';
// Anchored path prefix for /me/memberOf pagination URLs (group memberships).
const MEMBER_OF_PATH = '/v1.0/me/memberOf';

// Shared $select for user/org records: the base identity fields plus the org
// attributes (jobTitle/department/employeeId/officeLocation) Graph omits unless
// explicitly requested. Used by manager, direct reports, the caller profile and
// the manager-chain expansion so every GraphUser carries the same shape.
const ORG_USER_SELECT = 'id,displayName,mail,userPrincipalName,jobTitle,department,employeeId,officeLocation';

// Per-request timeout (env-overridable for slow tenants).
const GRAPH_TIMEOUT_MS = intFromEnv(process.env.GRAPH_TIMEOUT_MS, 10_000);

// Pagination guard: Graph pages /me/directReports ~100 entries/page, so 50 pages
// caps a single fetch at ~5000 reports — a belt-and-suspenders bound on time and
// memory in case of a pathological or looping @odata.nextLink chain.
const MAX_DIRECT_REPORT_PAGES = intFromEnv(process.env.GRAPH_MAX_PAGES, 50);

// Pagination guard for /me/memberOf group memberships (same belt-and-suspenders
// bound as direct reports, on its own env knob so the two can be tuned apart).
const MAX_GROUP_PAGES = intFromEnv(process.env.GRAPH_MAX_GROUP_PAGES, 20);

// Defensive cap on how deep the $expand=manager chain is walked. Bounds a
// pathological or cyclic manager graph (Entra should never produce one, but a
// data glitch must not loop or unbounded-grow the array).
const GRAPH_MAX_CHAIN_DEPTH = intFromEnv(process.env.GRAPH_MAX_CHAIN_DEPTH, 10);

// Bounded retry for transient failures. Graph and the login endpoint routinely
// emit 429 (throttling, usually with Retry-After) and transient 502/503/504; a
// single blip must not fail a live authorization check (approve/reject force a
// fresh Graph call and do NOT fall back to the DB cache, so an un-retried 429
// would wrongly block a legitimate manager).
const RETRY_MAX_ATTEMPTS = intFromEnv(process.env.GRAPH_RETRY_ATTEMPTS, 3);
const RETRY_BASE_MS = intFromEnv(process.env.GRAPH_RETRY_BASE_MS, 250);
const RETRY_MAX_DELAY_MS = intFromEnv(process.env.GRAPH_RETRY_MAX_DELAY_MS, 4_000);
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

// OBO access tokens live ~60-90 min; cache them keyed by the (hashed) user
// assertion so the hot authorization paths reuse one token instead of minting a
// fresh one on every approve/reject. forceRefresh re-checks membership live but
// the token is just the credential, so reusing a valid token keeps the freshness
// guarantee while halving outbound round-trips. Skew avoids using a near-expired
// token; tokens with no usable lifetime left are simply not cached.
const OBO_EXPIRY_SKEW_SECONDS = 60;

// One shared client so the timeout (and any future agent tuning) is configured in
// a single place and reused across the token + Graph calls.
const http = axios.create({ timeout: GRAPH_TIMEOUT_MS });

export interface GraphUser {
  id: string;           // Entra Object ID
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
  employeeId: string | null;
  officeLocation: string | null;
}

export interface GraphGroup {
  id: string;
  displayName: string | null;
}

// /me?$expand=manager($levels=max) returns the manager nested recursively under
// each `.manager` key; walk it nearest-first to flatten the chain.
interface ExpandedManager extends GraphUser {
  manager?: ExpandedManager | null;
}

// Graph omits absent directory attributes entirely, so a raw /me payload may be
// missing any of the org fields. Normalize a (partial) user into a full GraphUser
// with missing org attributes collapsed to `null`.
function normalizeOrgUser(raw: GraphUser): GraphUser {
  return {
    id: raw.id,
    displayName: raw.displayName,
    mail: raw.mail ?? null,
    userPrincipalName: raw.userPrincipalName,
    jobTitle: raw.jobTitle ?? null,
    department: raw.department ?? null,
    employeeId: raw.employeeId ?? null,
    officeLocation: raw.officeLocation ?? null,
  };
}

export type GraphApiFailureReason = 'consent_required' | 'unknown';

export class GraphApiAuthError extends Error {
  readonly reason: GraphApiFailureReason;
  readonly cause: unknown;

  constructor(message: string, reason: GraphApiFailureReason, cause: unknown) {
    super(message);
    this.name = 'GraphApiAuthError';
    this.reason = reason;
    this.cause = cause;
  }
}

export function isGraphApiAuthError(err: unknown): err is GraphApiAuthError {
  return typeof err === 'object'
    && err !== null
    && 'reason' in err
    && typeof (err as { reason?: unknown }).reason === 'string'
    && 'name' in err
    && (err as { name?: unknown }).name === 'GraphApiAuthError';
}

function isConsentRequiredError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) {
    return false;
  }

  const responseData = err.response?.data as {
    error?: string;
    suberror?: string;
    error_codes?: number[];
  } | undefined;

  return err.response?.status === 400
    && responseData?.error === 'invalid_grant'
    && (
      responseData?.suberror === 'consent_required'
      || responseData?.error_codes?.includes(65001) === true
    );
}

/**
 * Parse a Retry-After header (delta-seconds or an HTTP-date) into milliseconds.
 * Returns null when absent or unparseable.
 */
function parseRetryAfterMs(header: unknown): number | null {
  if (typeof header !== 'string' || header.trim() === '') {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function isRetryableError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) {
    return false;
  }
  // A response with a retryable status (throttling / transient 5xx).
  if (err.response) {
    return RETRYABLE_STATUS.has(err.response.status);
  }
  // No response at all = network/timeout error (ECONNRESET, ETIMEDOUT,
  // ECONNABORTED on timeout) — safe to retry an idempotent GET / fresh exchange.
  return true;
}

function retryDelayMs(attempt: number, retryAfterHeader: unknown): number {
  const retryAfter = parseRetryAfterMs(retryAfterHeader);
  if (retryAfter !== null) {
    return Math.min(retryAfter, RETRY_MAX_DELAY_MS);
  }
  const backoff = RETRY_BASE_MS * 2 ** (attempt - 1);
  return Math.min(backoff, RETRY_MAX_DELAY_MS);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Issue a request through the shared client with bounded retry on transient
 * failures. Only retries idempotent operations (Graph GETs and the fresh OBO
 * token exchange); never retries a 4xx (e.g. 400 consent, 401, 403, 404).
 */
async function graphRequest<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await http.request<T>(config);
    } catch (err) {
      lastErr = err;
      if (attempt >= RETRY_MAX_ATTEMPTS || !isRetryableError(err)) {
        throw err;
      }
      const retryAfter = axios.isAxiosError(err) ? err.response?.headers?.['retry-after'] : undefined;
      const delay = retryDelayMs(attempt, retryAfter);
      logger.warn('Retrying Microsoft Graph request after a transient failure', {
        attempt,
        maxAttempts: RETRY_MAX_ATTEMPTS,
        delayMs: delay,
        err: summarizeHttpError(err),
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}

function validateGraphNextLink(nextLink: string, allowedPathPrefix: string): string {
  let parsed: URL;
  try {
    parsed = new URL(nextLink);
  } catch {
    throw new Error('Microsoft Graph returned an invalid pagination URL');
  }

  // Anchor the path to a segment boundary so a sibling like
  // `/v1.0/me/directReportsEVIL` (or `/me/memberOfEVIL`) cannot satisfy the check.
  const pathAllowed =
    parsed.pathname === allowedPathPrefix
    || parsed.pathname.startsWith(`${allowedPathPrefix}/`);

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== GRAPH_HOSTNAME
    || !pathAllowed
  ) {
    throw new Error('Microsoft Graph returned an unexpected pagination URL');
  }

  return parsed.toString();
}

/**
 * Walk a paged Graph collection (`value` + `@odata.nextLink`) to completion,
 * returning the flattened items. Shared by direct reports and group memberships;
 * preserves the safety invariants both rely on:
 *  - a hard page cap (throws `... exceeded the N-page limit` before over-fetching);
 *  - a malformed body (no `value` array) throws rather than spreading `undefined`,
 *    and — because the throw happens here, before the caller caches — never lets a
 *    bogus empty result get cached for the TTL;
 *  - every `@odata.nextLink` is re-validated against `allowedPathPrefix`.
 */
async function paginateGraphCollection<T>(opts: {
  initialUrl: string;
  userAccessToken: string;
  allowedPathPrefix: string;
  pageCap: number;
  resourceName: string;
}): Promise<T[]> {
  const { initialUrl, userAccessToken, allowedPathPrefix, pageCap, resourceName } = opts;

  const graphToken = await getGraphTokenOBO(userAccessToken);
  const items: T[] = [];
  let nextUrl: string | null = initialUrl;
  let pageCount = 0;

  while (nextUrl) {
    if (pageCount >= pageCap) {
      throw new Error(`Microsoft Graph ${resourceName} exceeded the ${pageCap}-page limit`);
    }
    pageCount += 1;

    const response: AxiosResponse<{ value?: T[]; '@odata.nextLink'?: string }> =
      await graphRequest({
        method: 'get',
        url: nextUrl,
        headers: { Authorization: `Bearer ${graphToken}` },
      });

    if (!Array.isArray(response.data?.value)) {
      throw new Error(`Microsoft Graph ${resourceName} response was missing the expected "value" array`);
    }
    items.push(...response.data.value);

    const nextLink = response.data?.['@odata.nextLink'];
    nextUrl = nextLink ? validateGraphNextLink(nextLink, allowedPathPrefix) : null;
  }

  return items;
}

function oboCacheKey(userAccessToken: string): string {
  return `obo:${createHash('sha256').update(userAccessToken).digest('hex')}`;
}

/**
 * Exchange a user's access token for a Graph API token via the OBO flow.
 * Successful tokens are cached (keyed by the hashed assertion) until shortly
 * before their expiry so repeated authorization checks reuse one token.
 */
async function getGraphTokenOBO(userAccessToken: string): Promise<string> {
  if (!userAccessToken || userAccessToken.trim() === '') {
    throw new Error('Cannot exchange an empty user access token for a Graph token');
  }

  const cacheKey = oboCacheKey(userAccessToken);
  const cachedToken = cacheService.get<string>(cacheKey);
  if (cachedToken !== undefined) {
    return cachedToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${entraConfig.tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: entraConfig.clientId,
    client_secret: entraConfig.clientSecret,
    assertion: userAccessToken,
    scope: 'https://graph.microsoft.com/.default',
    requested_token_use: 'on_behalf_of',
  });

  try {
    const response = await graphRequest<{ access_token?: string; expires_in?: number }>({
      method: 'post',
      url: tokenUrl,
      data: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const accessToken = response.data?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('OBO token response did not include an access token');
    }

    const expiresIn = typeof response.data?.expires_in === 'number' ? response.data.expires_in : 0;
    const ttl = Math.floor(expiresIn) - OBO_EXPIRY_SKEW_SECONDS;
    if (ttl > 0) {
      cacheService.set(cacheKey, accessToken, ttl);
    }

    return accessToken;
  } catch (err) {
    if (isConsentRequiredError(err)) {
      logger.warn('Microsoft Graph delegated consent is required for OBO token exchange', {
        err: summarizeHttpError(err),
      });
      throw new GraphApiAuthError(
        'Microsoft Graph delegated consent is required before direct reports can be fetched.',
        'consent_required',
        err,
      );
    }

    throw err;
  }
}

async function graphGet<T>(path: string, userAccessToken: string, params?: Record<string, string>): Promise<T> {
  const graphToken = await getGraphTokenOBO(userAccessToken);
  const response = await graphRequest<T>({
    method: 'get',
    url: `${GRAPH_BASE_URL}${path}`,
    headers: { Authorization: `Bearer ${graphToken}` },
    params,
  });

  return response.data;
}

export const graphApiService = {
  /**
   * Get the signed-in user's manager via /me/manager.
   * Returns the manager's Graph profile, or null if no manager is assigned.
   * Results are cached for 15 minutes keyed by user DB id.
   */
  async getManager(userDbId: number, userAccessToken: string, options: { forceRefresh?: boolean } = {}): Promise<GraphUser | null> {
    const cacheKey = `manager:${userDbId}`;
    const cached = options.forceRefresh ? undefined : cacheService.get<GraphUser | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const manager = await graphGet<GraphUser>(
        '/me/manager',
        userAccessToken,
        { $select: ORG_USER_SELECT },
      );
      cacheService.set(cacheKey, manager);
      return manager;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        // No manager assigned in Entra ID
        cacheService.set(cacheKey, null);
        return null;
      }
      logger.error('Failed to fetch manager from Graph API', {
        err: summarizeHttpError(err),
        userDbId,
      });
      throw err;
    }
  },

  /**
   * Get the signed-in user's direct reports via /me/directReports.
   * Returns an array of Graph user profiles.
   * Results are cached for 15 minutes keyed by user DB id.
   */
  async getDirectReports(userDbId: number, userAccessToken: string, options: { forceRefresh?: boolean } = {}): Promise<GraphUser[]> {
    const cacheKey = `directReports:${userDbId}`;
    const cached = options.forceRefresh ? undefined : cacheService.get<GraphUser[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const reports = await paginateGraphCollection<GraphUser>({
        initialUrl: `${GRAPH_BASE_URL}/me/directReports/microsoft.graph.user?$select=${ORG_USER_SELECT}`,
        userAccessToken,
        allowedPathPrefix: DIRECT_REPORTS_PATH,
        pageCap: MAX_DIRECT_REPORT_PAGES,
        resourceName: 'direct reports',
      });
      cacheService.set(cacheKey, reports);
      return reports;
    } catch (err) {
      logger.error('Failed to fetch direct reports from Graph API', {
        err: summarizeHttpError(err),
        userDbId,
      });
      throw err;
    }
  },

  /**
   * Get the signed-in caller's own org profile via /me, including the org
   * attributes (jobTitle/department/employeeId/officeLocation). Cached for 15
   * minutes keyed by user DB id.
   */
  async getMyOrgProfile(userDbId: number, userAccessToken: string, options: { forceRefresh?: boolean } = {}): Promise<GraphUser> {
    const cacheKey = `meProfile:${userDbId}`;
    const cached = options.forceRefresh ? undefined : cacheService.get<GraphUser>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const profile = await graphGet<GraphUser>(
        '/me',
        userAccessToken,
        { $select: ORG_USER_SELECT },
      );
      const normalized = normalizeOrgUser(profile);
      cacheService.set(cacheKey, normalized);
      return normalized;
    } catch (err) {
      logger.error('Failed to fetch org profile from Graph API', {
        err: summarizeHttpError(err),
        userDbId,
      });
      throw err;
    }
  },

  /**
   * Get the caller's management chain (nearest-first: [directManager, skipLevel, …])
   * via /me?$expand=manager($levels=max). Returns [] when no manager is assigned.
   * Walks the nested .manager objects with a defensive depth cap. Cached for 15
   * minutes keyed by user DB id.
   */
  async getManagerChain(userDbId: number, userAccessToken: string, options: { forceRefresh?: boolean } = {}): Promise<GraphUser[]> {
    const cacheKey = `managerChain:${userDbId}`;
    const cached = options.forceRefresh ? undefined : cacheService.get<GraphUser[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const me = await graphGet<GraphUser & { manager?: ExpandedManager | null }>(
        '/me',
        userAccessToken,
        { $expand: `manager($levels=max;$select=${ORG_USER_SELECT})` },
      );

      const chain: GraphUser[] = [];
      let current: ExpandedManager | null = me.manager ?? null;
      let depth = 0;
      while (current) {
        if (depth >= GRAPH_MAX_CHAIN_DEPTH) {
          logger.warn('Microsoft Graph manager chain hit the depth cap; truncating', {
            userDbId,
            maxDepth: GRAPH_MAX_CHAIN_DEPTH,
          });
          break;
        }
        chain.push(normalizeOrgUser(current));
        depth += 1;
        current = current.manager ?? null;
      }

      cacheService.set(cacheKey, chain);
      return chain;
    } catch (err) {
      logger.error('Failed to fetch manager chain from Graph API', {
        err: summarizeHttpError(err),
        userDbId,
      });
      throw err;
    }
  },

  /**
   * Get the security + M365 groups the caller belongs to via /me/memberOf.
   * Paginated and cached for 15 minutes keyed by user DB id.
   */
  async getGroupMemberships(userDbId: number, userAccessToken: string, options: { forceRefresh?: boolean } = {}): Promise<GraphGroup[]> {
    const cacheKey = `groups:${userDbId}`;
    const cached = options.forceRefresh ? undefined : cacheService.get<GraphGroup[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const groups = await paginateGraphCollection<GraphGroup>({
        initialUrl: `${GRAPH_BASE_URL}/me/memberOf/microsoft.graph.group?$select=id,displayName`,
        userAccessToken,
        allowedPathPrefix: MEMBER_OF_PATH,
        pageCap: MAX_GROUP_PAGES,
        resourceName: 'group memberships',
      });
      const normalized = groups.map((group) => ({ id: group.id, displayName: group.displayName ?? null }));
      cacheService.set(cacheKey, normalized);
      return normalized;
    } catch (err) {
      logger.error('Failed to fetch group memberships from Graph API', {
        err: summarizeHttpError(err),
        userDbId,
      });
      throw err;
    }
  },

  /**
   * Check whether the signed-in manager directly manages the target subordinate.
   * Entra object IDs are compared case-insensitively so a casing difference
   * between the stored entra_id and Graph's response can't wrongly deny a
   * legitimate manager.
   */
  async isManagerOf(
    managerDbId: number,
    subordinateEntraId: string,
    userAccessToken: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<boolean> {
    const directReports = await this.getDirectReports(managerDbId, userAccessToken, options);
    const target = subordinateEntraId.toLowerCase();
    return directReports.some(
      (report) => typeof report.id === 'string' && report.id.toLowerCase() === target,
    );
  },
};
