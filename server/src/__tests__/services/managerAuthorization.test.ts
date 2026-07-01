import { Request } from 'express';
import {
  verifyManagerRelationship,
  ensureCanAccessExpense,
  getBearerToken,
} from '../../services/managerAuthorization';
import { userModel } from '../../models/user';
import {
  graphApiService,
  isGraphApiAuthError,
  GraphApiAuthError,
} from '../../services/graphApi';
import { Role, User } from '../../types';

jest.mock('../../models/user');
jest.mock('../../services/graphApi');

const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedGraphApiService = graphApiService as jest.Mocked<typeof graphApiService>;
const mockedIsGraphApiAuthError = isGraphApiAuthError as jest.MockedFunction<typeof isGraphApiAuthError>;

// The REAL type guard (bypassing the auto-mock) so at least one consent test
// exercises the actual classification logic rather than a forced return value.
const { isGraphApiAuthError: realIsGraphApiAuthError } =
  jest.requireActual('../../services/graphApi') as typeof import('../../services/graphApi');

// The signed-in manager (req.user) has DB id 2; the submitter has DB id 7.
const MANAGER_ID = 2;
const SUBMITTER_ID = 7;

const mockSubmitter = (overrides: Partial<User> = {}): User => ({
  id: SUBMITTER_ID,
  entra_id: 'entra-submitter',
  email: 'employee@test.com',
  display_name: 'Employee One',
  role: Role.EMPLOYEE,
  manager_id: null,
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const mockRequest = (overrides: Partial<Request> = {}): Request =>
  ({
    user: {
      id: MANAGER_ID,
      role: Role.MANAGER,
      assignedRoles: [Role.MANAGER],
      email: 'manager@test.com',
      display_name: 'Manager',
    },
    headers: {},
    params: {},
    query: {},
    ...overrides,
  } as Request);

describe('managerAuthorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // graphApi.isGraphApiAuthError is auto-mocked; default it to false so
    // unrelated branches don't accidentally take the consent path.
    mockedIsGraphApiAuthError.mockReturnValue(false);
  });

  describe('getBearerToken', () => {
    it('extracts the token from a well-formed Authorization header', () => {
      const req = mockRequest({ headers: { authorization: 'Bearer abc.def.ghi' } });
      expect(getBearerToken(req)).toBe('abc.def.ghi');
    });

    it('returns empty string when no Authorization header is present', () => {
      const req = mockRequest({ headers: {} });
      expect(getBearerToken(req)).toBe('');
    });

    it('returns empty string for a non-Bearer scheme', () => {
      const req = mockRequest({ headers: { authorization: 'Basic abc' } });
      expect(getBearerToken(req)).toBe('');
    });
  });

  describe('verifyManagerRelationship', () => {
    describe('ADMIN bypass', () => {
      it('always authorizes an admin without looking up the submitter or calling Graph', async () => {
        const req = mockRequest({
          user: { id: MANAGER_ID, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'a@test.com', display_name: 'Admin' },
          headers: { authorization: 'Bearer token-123' },
        });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result).toEqual({ allowed: true });
        expect(mockedUserModel.findById).not.toHaveBeenCalled();
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });
    });

    // A demo session resolves to a real ADMIN/MANAGER row, so it must be fenced
    // to its own workspace BEFORE the blanket admin bypass above — otherwise a
    // public demo admin could read/act on real or other-workspace expenses.
    describe('demo sandbox workspace boundary', () => {
      const demoAdmin = (sessionId?: string) => ({
        id: MANAGER_ID,
        role: Role.ADMIN,
        assignedRoles: [Role.ADMIN],
        email: 'demo.admin@demo.local',
        display_name: 'Demo Admin',
        demoMode: true,
        demoSessionId: sessionId,
      });
      const demoManager = (sessionId: string) => ({
        id: MANAGER_ID,
        role: Role.MANAGER,
        assignedRoles: [Role.MANAGER],
        email: 'demo.user@demo.local',
        display_name: 'Demo User',
        demoMode: true,
        demoSessionId: sessionId,
      });

      it('authorizes a demo ADMIN for a submitter in the SAME workspace, never calling Graph', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-1' }),
        );
        const req = mockRequest({ user: demoAdmin('sess-1'), headers: { authorization: 'Bearer demo-token' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result).toEqual({ allowed: true });
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('DENIES a demo ADMIN for a submitter in a DIFFERENT demo workspace', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-2' }),
        );
        const req = mockRequest({ user: demoAdmin('sess-1') });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('This expense is outside your demo workspace.');
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('DENIES a demo ADMIN for a real (non-demo) submitter', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 0, demo_session_id: null }),
        );
        const req = mockRequest({ user: demoAdmin('sess-1') });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('This expense is outside your demo workspace.');
      });

      it('DENIES a demo session that somehow lacks a workspace id', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-1' }),
        );
        const req = mockRequest({ user: demoAdmin(undefined) });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('This expense is outside your demo workspace.');
      });

      it('authorizes a demo MANAGER only for its own direct report in-workspace', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-1', manager_id: MANAGER_ID }),
        );
        const req = mockRequest({ user: demoManager('sess-1') });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result).toEqual({ allowed: true });
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('DENIES a demo MANAGER for a submitter in a DIFFERENT demo workspace', async () => {
        // Cross-workspace fence applies to demo MANAGERs too, not just ADMINs.
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-2', manager_id: MANAGER_ID }),
        );
        const req = mockRequest({ user: demoManager('sess-1') });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('This expense is outside your demo workspace.');
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('DENIES a demo MANAGER for an in-workspace user that is not its report', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-1', manager_id: 999 }),
        );
        const req = mockRequest({ user: demoManager('sess-1') });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('could not be verified from the local cache');
      });

      it('DENIES a demo session when the submitter row does not exist', async () => {
        // The demo branch runs before the ADMIN bypass, so a demo ADMIN pointed at
        // a missing/guessed id is denied at the workspace check, never allowed.
        mockedUserModel.findById.mockResolvedValue(null);
        const req = mockRequest({ user: demoAdmin('sess-1') });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Expense submitter not found');
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });
    });

    describe('submitter not found', () => {
      it('denies with a "submitter not found" reason and never calls Graph', async () => {
        mockedUserModel.findById.mockResolvedValue(null);
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Expense submitter not found');
        expect(mockedUserModel.findById).toHaveBeenCalledWith(SUBMITTER_ID);
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });
    });

    describe('Graph API verification (token present)', () => {
      it('authorizes when Graph confirms the user is the direct manager', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: null }));
        mockedGraphApiService.isManagerOf.mockResolvedValue(true);
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result).toEqual({ allowed: true });
        expect(mockedGraphApiService.isManagerOf).toHaveBeenCalledWith(
          MANAGER_ID,
          'entra-submitter',
          'token-123',
          {},
        );
      });

      it('denies when Graph says the user is NOT the direct manager (no cached fallback rescue)', async () => {
        // manager_id matches in the DB, but with a token the Graph result wins
        // and no cached fallback is consulted on a clean (non-throwing) "false".
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
        mockedGraphApiService.isManagerOf.mockResolvedValue(false);
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('No active manager relationship found in Microsoft Graph');
        expect(mockedGraphApiService.isManagerOf).toHaveBeenCalledTimes(1);
      });

      it('forwards forceRefresh option through to graphApiService.isManagerOf', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter());
        mockedGraphApiService.isManagerOf.mockResolvedValue(true);
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        await verifyManagerRelationship(req, SUBMITTER_ID, { forceRefresh: true });

        expect(mockedGraphApiService.isManagerOf).toHaveBeenCalledWith(
          MANAGER_ID,
          'entra-submitter',
          'token-123',
          { forceRefresh: true },
        );
      });
    });

    describe('Graph API throws -> cached fallback', () => {
      it('falls back to cached manager_id and authorizes when it matches (allowCachedFallback=true)', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
        mockedGraphApiService.isManagerOf.mockRejectedValue(new Error('Graph unavailable'));
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID, {
          allowCachedFallback: true,
        });

        expect(result).toEqual({ allowed: true });
        expect(mockedGraphApiService.isManagerOf).toHaveBeenCalledTimes(1);
      });

      it('falls back but DENIES (generic retry reason) when cached manager_id does NOT match (allowCachedFallback=true)', async () => {
        // The cache lookup returns not-allowed, but in the catch block that
        // denial reason is discarded: a non-auth error yields the generic retry
        // message rather than the local-cache reason.
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: 999 }));
        mockedGraphApiService.isManagerOf.mockRejectedValue(new Error('Graph unavailable'));
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID, {
          allowCachedFallback: true,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Unable to verify manager relationship. Please try again later.');
      });

      it('DENIES on Graph failure when allowCachedFallback=false even if cached manager_id matches', async () => {
        // fallback disabled => cache cannot rescue, non-auth error => generic retry.
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
        mockedGraphApiService.isManagerOf.mockRejectedValue(new Error('Graph unavailable'));
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID, {
          allowCachedFallback: false,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Unable to verify manager relationship. Please try again later.');
      });

      it('DENIES with the generic retry reason on a non-auth Graph failure with no usable cache (fallback disabled)', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: 999 }));
        mockedGraphApiService.isManagerOf.mockRejectedValue(new Error('Graph 500'));
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID); // defaults: fallback off

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Unable to verify manager relationship. Please try again later.');
      });
    });

    describe('consent_required handling on Graph failure', () => {
      it('returns the consent-specific reason when Graph raises consent_required and no cache rescue applies', async () => {
        // allowCachedFallback true but manager_id does NOT match => cache cannot
        // rescue, so the consent-specific branch is reached.
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: 999 }));
        // graphApi is auto-mocked, so the GraphApiAuthError *class* is a no-op
        // constructor that would not preserve `.reason`. Use a plain shaped
        // object (as managerController.test.ts does) and force the type guard.
        const consentErr = {
          name: 'GraphApiAuthError',
          reason: 'consent_required',
        } as GraphApiAuthError;
        mockedGraphApiService.isManagerOf.mockRejectedValue(consentErr);
        mockedIsGraphApiAuthError.mockReturnValue(true);
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID, {
          allowCachedFallback: true,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          'Microsoft Graph consent is required and no local manager assignment is cached for this employee.',
        );
      });

      it('classifies a real GraphApiAuthError shape via the ACTUAL type guard (regression-proof)', async () => {
        // Unlike the test above, this does NOT force isGraphApiAuthError to true.
        // It runs the REAL guard against a properly-shaped GraphApiAuthError, so a
        // classification regression (checking the wrong field, dropping `reason`)
        // would flip the result to the generic retry message and fail here.
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: 999 }));
        mockedIsGraphApiAuthError.mockImplementation(realIsGraphApiAuthError);
        const consentErr = Object.assign(new Error('consent required'), {
          name: 'GraphApiAuthError',
          reason: 'consent_required' as const,
        });
        mockedGraphApiService.isManagerOf.mockRejectedValue(consentErr);
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID, {
          allowCachedFallback: true,
        });

        // The real guard actually returned true for this shape (not stubbed).
        expect(mockedIsGraphApiAuthError).toHaveReturnedWith(true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          'Microsoft Graph consent is required and no local manager assignment is cached for this employee.',
        );
      });

      it('lets the cached fallback rescue take precedence over the consent message when manager_id matches', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
        const consentErr = {
          name: 'GraphApiAuthError',
          reason: 'consent_required',
        } as GraphApiAuthError;
        mockedGraphApiService.isManagerOf.mockRejectedValue(consentErr);
        mockedIsGraphApiAuthError.mockReturnValue(true);
        const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID, {
          allowCachedFallback: true,
        });

        expect(result).toEqual({ allowed: true });
      });
    });

    describe('no bearer token (real auth)', () => {
      it('authorizes from cached manager_id when it matches and fallback is allowed', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
        const req = mockRequest({ headers: {} });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID, {
          allowCachedFallback: true,
        });

        expect(result).toEqual({ allowed: true });
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('denies with the "without a bearer token" reason when cache cannot rescue', async () => {
        // fallback allowed but manager_id mismatches -> cache returns not-allowed,
        // and since there was no token the no-token reason is surfaced.
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: 999 }));
        const req = mockRequest({ headers: {} });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID, {
          allowCachedFallback: true,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          'Manager relationship could not be verified without a bearer token.',
        );
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('denies with the "without a bearer token" reason when fallback is disabled', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
        const req = mockRequest({ headers: {} });

        // fallback disabled: allowFromDatabaseCache short-circuits to not-allowed,
        // then the no-token wrapper rewrites the reason.
        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          'Manager relationship could not be verified without a bearer token.',
        );
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });
    });

    describe('stub auth (dev) path', () => {
      it('trusts cached manager_id without a token and without calling Graph (match -> allowed)', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
        const req = mockRequest({
          user: {
            id: MANAGER_ID,
            role: Role.MANAGER,
            assignedRoles: [Role.MANAGER],
            email: 'manager@test.com',
            display_name: 'Manager',
            stubAuth: true,
          },
          headers: {},
        });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result).toEqual({ allowed: true });
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('denies under stub auth when cached manager_id does not match', async () => {
        mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: 999 }));
        const req = mockRequest({
          user: {
            id: MANAGER_ID,
            role: Role.MANAGER,
            assignedRoles: [Role.MANAGER],
            email: 'manager@test.com',
            display_name: 'Manager',
            stubAuth: true,
          },
          headers: {},
        });

        const result = await verifyManagerRelationship(req, SUBMITTER_ID);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('could not be verified from the local cache');
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('does NOT honor the stub cache bypass in production (defense-in-depth)', async () => {
        // Even with a matching manager_id and the stub flag set, a production
        // NODE_ENV must never let the cached fallback rescue a tokenless request.
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
          mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
          const req = mockRequest({
            user: {
              id: MANAGER_ID,
              role: Role.MANAGER,
              assignedRoles: [Role.MANAGER],
              email: 'manager@test.com',
              display_name: 'Manager',
              stubAuth: true,
            },
            headers: {},
          });

          const result = await verifyManagerRelationship(req, SUBMITTER_ID);

          expect(result.allowed).toBe(false);
          expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
        } finally {
          process.env.NODE_ENV = previousEnv;
        }
      });
    });
  });

  describe('ensureCanAccessExpense', () => {
    it('allows a user to access their OWN expense without any model/Graph lookup', async () => {
      const req = mockRequest({
        user: { id: MANAGER_ID, role: Role.EMPLOYEE, assignedRoles: [Role.EMPLOYEE], email: 'e@test.com', display_name: 'E' },
      });

      await expect(ensureCanAccessExpense(req, MANAGER_ID)).resolves.toBeUndefined();
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
      expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
    });

    it('forbids an EMPLOYEE from accessing another user\'s expense', async () => {
      const req = mockRequest({
        user: { id: MANAGER_ID, role: Role.EMPLOYEE, assignedRoles: [Role.EMPLOYEE], email: 'e@test.com', display_name: 'E' },
      });

      await expect(ensureCanAccessExpense(req, SUBMITTER_ID)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(mockedUserModel.findById).not.toHaveBeenCalled();
    });

    it('allows an ADMIN to access any expense (bypass)', async () => {
      const req = mockRequest({
        user: { id: MANAGER_ID, role: Role.ADMIN, assignedRoles: [Role.ADMIN], email: 'a@test.com', display_name: 'A' },
      });

      await expect(ensureCanAccessExpense(req, SUBMITTER_ID)).resolves.toBeUndefined();
      expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
    });

    it('allows a MANAGER when Graph confirms the relationship', async () => {
      mockedUserModel.findById.mockResolvedValue(mockSubmitter());
      mockedGraphApiService.isManagerOf.mockResolvedValue(true);
      const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

      await expect(ensureCanAccessExpense(req, SUBMITTER_ID)).resolves.toBeUndefined();
      // ensureCanAccessExpense pins allowCachedFallback: false and forces a live
      // Graph check so read access tracks the current reporting chain (no TTL window).
      expect(mockedGraphApiService.isManagerOf).toHaveBeenCalledWith(
        MANAGER_ID,
        'entra-submitter',
        'token-123',
        { allowCachedFallback: false, forceRefresh: true },
      );
    });

    it('forbids a MANAGER (403) when Graph denies the relationship, surfacing the reason', async () => {
      mockedUserModel.findById.mockResolvedValue(mockSubmitter());
      mockedGraphApiService.isManagerOf.mockResolvedValue(false);
      const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

      await expect(ensureCanAccessExpense(req, SUBMITTER_ID)).rejects.toMatchObject({
        statusCode: 403,
        message: expect.stringContaining('No active manager relationship found in Microsoft Graph'),
      });
    });

    it('forbids a MANAGER (403) on Graph failure because cached fallback is disabled', async () => {
      mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: MANAGER_ID }));
      mockedGraphApiService.isManagerOf.mockRejectedValue(new Error('Graph unavailable'));
      const req = mockRequest({ headers: { authorization: 'Bearer token-123' } });

      await expect(ensureCanAccessExpense(req, SUBMITTER_ID)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    // Drive the read-gate directly through its demo branch: a demo caller may only
    // ever read an expense whose submitter belongs to the SAME demo session.
    describe('demo workspace boundary (read-gate)', () => {
      const demoManagerUser = (sessionId: string) => ({
        id: MANAGER_ID,
        role: Role.MANAGER,
        assignedRoles: [Role.MANAGER],
        email: 'demo.user@demo.local',
        display_name: 'Demo User',
        demoMode: true,
        demoSessionId: sessionId,
      });
      const demoAdminUser = (sessionId: string) => ({
        id: MANAGER_ID,
        role: Role.ADMIN,
        assignedRoles: [Role.ADMIN],
        email: 'demo.admin@demo.local',
        display_name: 'Demo Admin',
        demoMode: true,
        demoSessionId: sessionId,
      });

      it('403s a demo MANAGER reading an expense from a DIFFERENT demo workspace', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-2', manager_id: MANAGER_ID }),
        );
        const req = mockRequest({ user: demoManagerUser('sess-1') });

        await expect(ensureCanAccessExpense(req, SUBMITTER_ID)).rejects.toMatchObject({
          statusCode: 403,
          message: expect.stringContaining('outside your demo workspace'),
        });
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('403s a demo ADMIN reading an expense from a DIFFERENT demo workspace', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-2' }),
        );
        const req = mockRequest({ user: demoAdminUser('sess-1') });

        await expect(ensureCanAccessExpense(req, SUBMITTER_ID)).rejects.toMatchObject({
          statusCode: 403,
          message: expect.stringContaining('outside your demo workspace'),
        });
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });

      it('allows a demo MANAGER to read a same-workspace direct report (no Graph call)', async () => {
        mockedUserModel.findById.mockResolvedValue(
          mockSubmitter({ is_demo: 1, demo_session_id: 'sess-1', manager_id: MANAGER_ID }),
        );
        const req = mockRequest({ user: demoManagerUser('sess-1') });

        await expect(ensureCanAccessExpense(req, SUBMITTER_ID)).resolves.toBeUndefined();
        expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      });
    });
  });
});
