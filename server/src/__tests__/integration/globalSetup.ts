/**
 * Jest globalSetup for the integration suite. Runs once in the parent process
 * before any test file is loaded, so the run fails fast — before a single pool
 * is opened — if the target database is not disposable. This is the primary
 * guard (it fires even for a future suite that forgets to import ./setup); the
 * destructive helpers in ./setup re-assert it as defense in depth.
 *
 * Imports only the pure guard (no pool/db side effects in the parent process).
 */
import { assertDisposableTestDatabase } from './guardTestDatabase';

export default async function globalSetup(): Promise<void> {
  assertDisposableTestDatabase();
}
