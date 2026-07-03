import winston from 'winston';
import type Transport from 'winston-transport';
import crypto from 'crypto';
import { redactLogValue } from '../utils/logSanitizer';
import { getPulsarLogsTransport } from './pulsarLogsTransport';

export const generateCorrelationId = (): string =>
  crypto.randomUUID();

// Validate LOG_LEVEL against winston's known levels. An unrecognized value
// (a typo like "warning" or "debugg") otherwise silently suppresses ALL output
// because no message passes the level filter — a one-character ops mistake that
// blinds production logging. Fall back to "info" and warn loudly instead.
function resolveLogLevel(): string {
  const requested = process.env.LOG_LEVEL;
  if (!requested) return 'info';
  if (Object.keys(winston.config.npm.levels).includes(requested)) return requested;
  // eslint-disable-next-line no-console
  console.warn(`Ignoring invalid LOG_LEVEL "${requested}"; falling back to "info"`);
  return 'info';
}

const redactFormat = winston.format((info) => {
  const redacted = redactLogValue(info) as Record<string, unknown>;
  for (const [key, value] of Object.entries(redacted)) {
    info[key] = value;
  }
  return info;
});

const transports: Transport[] = [
  new winston.transports.Console({
    format:
      process.env.NODE_ENV !== 'production'
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        : winston.format.json(),
  }),
];

// Ship warn+error lines (info opt-in) to the Pulsar dashboard when configured.
// Off unless PULSAR_LOGS_URL + LOGS_INGEST_KEY are set. It inherits the already
// redacted/stamped `info` like any transport, so no extra format is needed.
const pulsarTransport = getPulsarLogsTransport();
if (pulsarTransport) {
  transports.push(pulsarTransport);
}

const logger = winston.createLogger({
  level: resolveLogLevel(),
  // Stamp every line with stable deploy identity. Multiple apps/replicas write to
  // one shared Log Analytics workspace, so these let an operator filter by app
  // (service), by environment (env), and by exact release (version) — and trace a
  // single log line back to the build that emitted it. `version` falls through the
  // CI-injected sha to the package version, so it is never blank.
  // Merged into every `info` object before the format chain runs, so redactFormat()
  // (first in the combine below) still processes these fields like any other.
  defaultMeta: {
    service: 'expense-management-api',
    env: process.env.NODE_ENV ?? 'development',
    version:
      process.env.APP_VERSION ||
      process.env.GIT_SHA ||
      process.env.npm_package_version ||
      'unknown',
  },
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
});

export default logger;
