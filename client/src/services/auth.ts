import type { Configuration } from '@azure/msal-browser';
import { PublicClientApplication } from '@azure/msal-browser';
import { ENTRA_CLIENT_ID, ENTRA_TENANT_ID, LOGIN_SCOPES, REDIRECT_URI } from './env';

if (import.meta.env.PROD && !ENTRA_CLIENT_ID) {
  throw new Error('VITE_ENTRA_CLIENT_ID is required for production builds');
}

const msalConfig: Configuration = {
  auth: {
    clientId: ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
    redirectUri: REDIRECT_URI,
  },
  cache: {
    // sessionStorage: tokens survive page reloads (avoiding redirect on every refresh)
    // but are still tab-isolated and cleared when the tab closes. With PKCE +
    // short-lived access tokens this is the standard recommendation.
    cacheLocation: 'sessionStorage',
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

/**
 * Must be awaited before passing msalInstance to MsalProvider.
 * Handles redirect promise so post-login redirects are processed.
 */
export const msalReady = msalInstance.initialize().then(() => {
  return msalInstance.handleRedirectPromise().then((redirectResponse) => {
    const account = redirectResponse?.account
      ?? msalInstance.getActiveAccount()
      ?? msalInstance.getAllAccounts()[0]
      ?? null;

    if (account) {
      msalInstance.setActiveAccount(account);
    }

    return redirectResponse;
  });
});

export const loginRequest = {
  scopes: LOGIN_SCOPES,
};
