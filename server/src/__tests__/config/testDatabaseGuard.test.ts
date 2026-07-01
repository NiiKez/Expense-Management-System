import {
  assertDisposableTestDatabase,
  isDisposableTestDbName,
  resolveTestDbName,
} from '../integration/guardTestDatabase';

describe('integration-test disposable-database guard', () => {
  describe('resolveTestDbName', () => {
    it('uses DB_NAME when set', () => {
      expect(resolveTestDbName({ DB_NAME: 'expense_management_test' } as NodeJS.ProcessEnv)).toBe(
        'expense_management_test',
      );
    });

    it('falls back to the dev default when DB_NAME is unset (so the default is refused)', () => {
      expect(resolveTestDbName({} as NodeJS.ProcessEnv)).toBe('expense_management');
    });

    it('treats a blank/whitespace DB_NAME as unset', () => {
      expect(resolveTestDbName({ DB_NAME: '   ' } as NodeJS.ProcessEnv)).toBe('expense_management');
    });
  });

  describe('isDisposableTestDbName', () => {
    it.each(['expense_management_test', 'test_db', 'TEST', 'ci_TEST_42', 'my_test_database', 'test'])(
      'accepts %s (has a bounded "test" token)',
      (name) => {
        expect(isDisposableTestDbName(name)).toBe(true);
      },
    );

    it.each(['expense_management', 'production', 'expense_app', 'prod_db', ''])(
      'rejects %s (no "test" token)',
      (name) => {
        expect(isDisposableTestDbName(name)).toBe(false);
      },
    );

    // The dangerous class for a DESTRUCTIVE guard: real words that merely embed
    // the letters t-e-s-t. A naive /test/ substring would classify these as
    // disposable and wipe them.
    it.each(['latest', 'contest', 'greatest', 'attestation', 'protest', 'testify'])(
      'rejects %s (letters "test" embedded in a larger word, not a token)',
      (name) => {
        expect(isDisposableTestDbName(name)).toBe(false);
      },
    );

    // Fail closed on environment markers even when a "test" token is present.
    it.each(['prod_test_snapshot', 'live_test', 'test_production_copy', 'staging_test', 'main_test'])(
      'rejects %s (carries a real-environment token despite containing "test")',
      (name) => {
        expect(isDisposableTestDbName(name)).toBe(false);
      },
    );
  });

  describe('assertDisposableTestDatabase', () => {
    it('passes for the CI test database name', () => {
      expect(() =>
        assertDisposableTestDatabase({ DB_NAME: 'expense_management_test' } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it('throws for the dev database name', () => {
      expect(() =>
        assertDisposableTestDatabase({ DB_NAME: 'expense_management' } as NodeJS.ProcessEnv),
      ).toThrow(/Refusing to run destructive integration-test helpers against database "expense_management"/);
    });

    it('throws when DB_NAME is unset (defaults to the dev DB)', () => {
      expect(() => assertDisposableTestDatabase({} as NodeJS.ProcessEnv)).toThrow(
        /expense_management/,
      );
    });

    it('error message points operators at a fix', () => {
      expect(() =>
        assertDisposableTestDatabase({ DB_NAME: 'prod' } as NodeJS.ProcessEnv),
      ).toThrow(/docker-compose\.test\.yml/);
    });
  });
});
