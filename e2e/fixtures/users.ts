// Mirrors database/seed.sql + client/src/context/stubUsers.ts.
// Used by Playwright fixtures so specs can refer to seeded users by name.
export const STUB_USERS = {
  alice: { id: 1, displayName: 'Alice Admin', email: 'admin@contoso.com', role: 'ADMIN' },
  bob: { id: 2, displayName: 'Bob Manager', email: 'manager.bob@contoso.com', role: 'MANAGER' },
  carol: { id: 3, displayName: 'Carol Manager', email: 'manager.carol@contoso.com', role: 'MANAGER' },
  dave: { id: 4, displayName: 'Dave Employee', email: 'dave@contoso.com', role: 'EMPLOYEE' },
  eve: { id: 5, displayName: 'Eve Employee', email: 'eve@contoso.com', role: 'EMPLOYEE' },
  frank: { id: 6, displayName: 'Frank Employee', email: 'frank@contoso.com', role: 'EMPLOYEE' },
  grace: { id: 7, displayName: 'Grace Employee', email: 'grace@contoso.com', role: 'EMPLOYEE' },
} as const satisfies Record<string, StubUserDef>;

interface StubUserDef {
  readonly id: number;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
}

export type StubUserKey = keyof typeof STUB_USERS;
export type StubUser = typeof STUB_USERS[StubUserKey];
