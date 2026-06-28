import 'dotenv/config';
import express from 'express';
import app from './src/app';
import pool from './src/config/db';
import logger from './src/config/logger';
import { summarizeHttpError } from './src/utils/logSanitizer';
import { register } from './src/services/metricsService';
import { intFromEnv } from './src/utils/env';
import { isDemoEnabled } from './src/config/demo';
import { startDemoCleanup } from './src/services/demoService';

const REQUIRED_PRODUCTION_ENV = [
  'CORS_ORIGIN',
  'DB_HOST',
  'DB_NAME',
  'DB_PASSWORD',
  'DB_USER',
];

const REQUIRED_ENTRA_ENV = [
  'ENTRA_CLIENT_ID',
  'ENTRA_CLIENT_SECRET',
  'ENTRA_TENANT_ID',
];

const stubAuthEnabled = process.env.ALLOW_STUB_AUTH === 'true';

// Fail-fast: the stub-auth bypass must never be reachable outside development.
if (stubAuthEnabled && process.env.NODE_ENV !== 'development') {
  // eslint-disable-next-line no-console
  console.error('FATAL: ALLOW_STUB_AUTH=true is only permitted when NODE_ENV=development');
  process.exit(1);
}

// Fail-fast: enabling the public demo without a signing secret would mint
// unverifiable demo tokens. Require the pair or neither.
if (process.env.ENABLE_DEMO === 'true' && !process.env.DEMO_JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('FATAL: ENABLE_DEMO=true requires DEMO_JWT_SECRET to be set');
  process.exit(1);
}

// Real Entra auth needs the app-registration config. Require it whenever the stub
// bypass is NOT enabled (production, staging, or any non-dev deployment), not just
// in production — an empty tenant/client id otherwise yields a broken JWKS URI and
// opaque 401s on every login instead of a clear failure at boot.
if (!stubAuthEnabled) {
  const missingEntra = REQUIRED_ENTRA_ENV.filter((name) => !process.env[name]);
  if (missingEntra.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: missing required Entra environment variables: ${missingEntra.join(', ')}`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === 'production') {
  const missingEnv = REQUIRED_PRODUCTION_ENV.filter((name) => !process.env[name]);
  if (missingEnv.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: missing required production environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
  }
}

// Require a CORS origin in every non-development environment (staging as well as
// production). Without it, allowedOrigins is empty, credentialed CORS silently
// degrades, and every browser request from the SPA is rejected with an opaque
// failure instead of a clear error at boot. (Production is already covered above;
// this extends the guarantee to staging and any other non-dev deploy.)
if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN.trim() === '') {
    // eslint-disable-next-line no-console
    console.error('FATAL: CORS_ORIGIN is required when NODE_ENV is not "development"');
    process.exit(1);
  }
}

const PORT = intFromEnv(process.env.PORT, 3000);

const httpServer = app.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});

// Periodically reap expired public-demo workspaces (no-op unless demo is on).
const stopDemoCleanup = isDemoEnabled() ? startDemoCleanup() : null;

// Prometheus metrics listener on a separate, unauthenticated port.
// This port must NOT be exposed to the host — Prometheus scrapes it over the
// internal Docker network. Default 9464 follows the OpenMetrics convention.
const metricsApp = express();
metricsApp.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
const METRICS_PORT = intFromEnv(process.env.METRICS_PORT, 9464);
const METRICS_HOST = process.env.METRICS_HOST || '127.0.0.1';
const metricsServer = metricsApp.listen(METRICS_PORT, METRICS_HOST, () => {
  logger.info(`Metrics listener on ${METRICS_HOST}:${METRICS_PORT}`);
});

// Graceful shutdown: on SIGTERM/SIGINT (e.g. `docker stop`, orchestrator
// rollout) stop accepting new connections, let in-flight requests drain, then
// close the DB pool. Without this, Node exits immediately — killing in-flight
// responses and tearing down MySQL connections uncleanly, which surfaces as 5xx
// and connection resets on every deploy.
const SHUTDOWN_TIMEOUT_MS = intFromEnv(process.env.SHUTDOWN_TIMEOUT_MS, 10_000);
let shuttingDown = false;

function closeServer(server: import('http').Server, name: string): Promise<void> {
  return new Promise((resolve) => {
    server.close((err) => {
      if (err) logger.warn(`Error closing ${name} listener`, { err: summarizeHttpError(err) });
      resolve();
    });
  });
}

// exitCode lets a fatal trigger (uncaughtException/unhandledRejection) drain
// cleanly but still exit non-zero, so restart-on-failure orchestrators treat the
// crash as a failure rather than reading exit 0 as an intended shutdown.
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully`);

  // Hard ceiling: if draining stalls (a hung keep-alive socket, a stuck query),
  // force-exit rather than hang the orchestrator's termination grace period.
  const forceTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  try {
    if (stopDemoCleanup) stopDemoCleanup();
    await Promise.all([
      closeServer(httpServer, 'HTTP'),
      closeServer(metricsServer, 'metrics'),
    ]);
    await pool.end();
    logger.info('Shutdown complete');
    clearTimeout(forceTimer);
    process.exit(exitCode);
  } catch (err) {
    logger.error('Error during shutdown', { err: summarizeHttpError(err) });
    clearTimeout(forceTimer);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Last-resort handlers. A rejection/exception that escapes a route would
// otherwise terminate the process with a raw stderr dump that bypasses the
// Winston transport AND its secret-redaction format. Route them through the
// sanitizer, then drain and exit so the orchestrator restarts a clean process.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { err: summarizeHttpError(reason) });
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: summarizeHttpError(err) });
  void shutdown('uncaughtException', 1);
});
