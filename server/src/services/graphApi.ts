import axios from 'axios';
import { entraConfig } from '../config/entra';
import { cacheService } from './cacheService';
import logger from '../config/logger';
import { summarizeHttpError } from '../utils/logSanitizer';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_TIMEOUT_MS = 10_000;
const GRAPH_HOSTNAME = 'graph.microsoft.com';

export interface GraphUser {
  id: string;           // Entra Object ID
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
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

function validateGraphNextLink(nextLink: string): string {
  let parsed: URL;
  try {
    parsed = new URL(nextLink);
  } catch {
    throw new Error('Microsoft Graph returned an invalid pagination URL');
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== GRAPH_HOSTNAME
    || !parsed.pathname.startsWith('/v1.0/me/directReports')
  ) {
    throw new Error('Microsoft Graph returned an unexpected pagination URL');
  }

  return parsed.toString();
}

/**
 * Exchange a user's access token for a Graph API token via the OBO flow.
 */
async function getGraphTokenOBO(userAccessToken: string): Promise<string> {
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
    const response = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: GRAPH_TIMEOUT_MS,
    });

    const accessToken = response.data?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('OBO token response did not include an access token');
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
  const response = await axios.get<T>(`${GRAPH_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${graphToken}` },
    params,
    timeout: GRAPH_TIMEOUT_MS,
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
        { $select: 'id,displayName,mail,userPrincipalName' },
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
      const graphToken = await getGraphTokenOBO(userAccessToken);
      const reports: GraphUser[] = [];
      let nextUrl: string | null = `${GRAPH_BASE_URL}/me/directReports/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName`;

      while (nextUrl) {
        const response: { data: { value: GraphUser[]; '@odata.nextLink'?: string } } = await axios.get(nextUrl, {
          headers: { Authorization: `Bearer ${graphToken}` },
          timeout: GRAPH_TIMEOUT_MS,
        });

        reports.push(...response.data.value);
        const nextLink = response.data['@odata.nextLink'];
        nextUrl = nextLink ? validateGraphNextLink(nextLink) : null;
      }

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
   * Check whether the signed-in manager directly manages the target subordinate.
   */
  async isManagerOf(
    managerDbId: number,
    subordinateEntraId: string,
    userAccessToken: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<boolean> {
    const directReports = await this.getDirectReports(managerDbId, userAccessToken, options);
    return directReports.some((report) => report.id === subordinateEntraId);
  },
};
