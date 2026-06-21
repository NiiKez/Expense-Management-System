const DEFAULT_AUDIENCES = (clientId: string): string[] => {
  const explicit = process.env.ENTRA_TOKEN_AUDIENCE;
  if (explicit) {
    return explicit.split(',').map((s) => s.trim()).filter(Boolean);
  }
  // Accept both v1.0 (api://{clientId}) and v2.0 ({clientId}) audiences by default.
  // Filter empties so a missing clientId never produces an empty-string audience,
  // which jsonwebtoken would otherwise treat as a matchable value.
  return [`api://${clientId}`, clientId].filter((aud) => aud && aud !== 'api://');
};

export const entraConfig = {
  tenantId: process.env.ENTRA_TENANT_ID || '',
  clientId: process.env.ENTRA_CLIENT_ID || '',
  clientSecret: process.env.ENTRA_CLIENT_SECRET || '',

  get authority(): string {
    return `https://login.microsoftonline.com/${this.tenantId}`;
  },

  get jwksUri(): string {
    return `https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`;
  },

  // Accept both v1.0 (sts.windows.net) and v2.0 (login.microsoftonline.com/.../v2.0) issuers.
  get issuers(): string[] {
    return [
      `https://sts.windows.net/${this.tenantId}/`,
      `https://login.microsoftonline.com/${this.tenantId}/v2.0`,
    ];
  },

  get audiences(): string[] {
    return DEFAULT_AUDIENCES(this.clientId);
  },
};
