import 'dotenv/config';
import express from 'express';
import app from './src/app';
import logger from './src/config/logger';
import { register } from './src/services/metricsService';

const REQUIRED_PRODUCTION_ENV = [
  'CORS_ORIGIN',
  'DB_HOST',
  'DB_NAME',
  'DB_PASSWORD',
  'DB_USER',
  'ENTRA_CLIENT_ID',
  'ENTRA_CLIENT_SECRET',
  'ENTRA_TENANT_ID',
];

// Fail-fast: the stub-auth bypass must never be reachable outside development.
if (process.env.ALLOW_STUB_AUTH === 'true' && process.env.NODE_ENV !== 'development') {
  // eslint-disable-next-line no-console
  console.error('FATAL: ALLOW_STUB_AUTH=true is only permitted when NODE_ENV=development');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  const missingEnv = REQUIRED_PRODUCTION_ENV.filter((name) => !process.env[name]);
  if (missingEnv.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: missing required production environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});

// Prometheus metrics listener on a separate, unauthenticated port.
// This port must NOT be exposed to the host — Prometheus scrapes it over the
// internal Docker network. Default 9464 follows the OpenMetrics convention.
const metricsApp = express();
metricsApp.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
const METRICS_PORT = Number(process.env.METRICS_PORT) || 9464;
const METRICS_HOST = process.env.METRICS_HOST || '127.0.0.1';
metricsApp.listen(METRICS_PORT, METRICS_HOST, () => {
  logger.info(`Metrics listener on ${METRICS_HOST}:${METRICS_PORT}`);
});
