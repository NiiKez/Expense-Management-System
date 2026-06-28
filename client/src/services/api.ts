import axios from 'axios';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { msalInstance, loginRequest } from './auth';
import { API_BASE_URL, IS_STUB_AUTH_MODE } from './env';
import { getStoredStubUserId } from './stubAuth';
import { clearDemoToken, getStoredDemoToken } from './demoAuth';

// Why no default Content-Type: setting application/json here makes axios call
// formDataToJSON() on FormData payloads (turning File parts into "{}"), which
// silently drops receipt uploads. Letting axios pick the header per-request
// keeps JSON for objects and multipart/form-data (with boundary) for FormData.
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
});

api.interceptors.request.use(async (config) => {
  // Demo session takes precedence: a server-signed demo JWT, sent like any
  // bearer token. Production-safe and independent of MSAL/stub.
  const demoToken = getStoredDemoToken();
  if (demoToken) {
    config.headers.Authorization = `Bearer ${demoToken}`;
    return config;
  }

  if (IS_STUB_AUTH_MODE) {
    const stubUserId = getStoredStubUserId();
    if (stubUserId) {
      config.headers['X-Stub-User-Id'] = String(stubUserId);
    }
    return config;
  }

  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (account) {
    try {
      const response = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account,
      });
      config.headers.Authorization = `Bearer ${response.accessToken}`;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        // Trigger redirect and never resolve — the page is about to navigate
        // away, so resolving/rejecting would surface as an unhandled rejection.
        await msalInstance.acquireTokenRedirect(loginRequest);
        return new Promise(() => {});
      }

      return Promise.reject(err);
    }
  }
  return config;
});

// 401 handler: if the API rejects the bearer token (e.g. user role revoked
// between issuance and use), force a fresh redirect so the user re-auths.
let redirectInFlight = false;
api.interceptors.response.use(
  (response) => response,
  async (err) => {
    const status = err?.response?.status;

    // Demo sessions can't silently re-auth. If the token expired or its
    // workspace was reaped, clear it and return to the login screen.
    if (getStoredDemoToken()) {
      if (status === 401) {
        clearDemoToken();
        window.location.assign('/login');
        return new Promise(() => {});
      }
      return Promise.reject(err);
    }

    if (!IS_STUB_AUTH_MODE && status === 401 && !redirectInFlight) {
      redirectInFlight = true;
      try {
        await msalInstance.acquireTokenRedirect(loginRequest);
      } catch {
        redirectInFlight = false;
      }
      return new Promise(() => {});
    }
    return Promise.reject(err);
  },
);

export default api;
