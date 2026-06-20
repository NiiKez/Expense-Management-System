import winston from 'winston';
import crypto from 'crypto';
import { redactLogValue } from '../utils/logSanitizer';

export const generateCorrelationId = (): string =>
  crypto.randomUUID();

const redactFormat = winston.format((info) => {
  const redacted = redactLogValue(info) as Record<string, unknown>;
  for (const [key, value] of Object.entries(redacted)) {
    info[key] = value;
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV !== 'production'
          ? winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          : winston.format.json(),
    }),
  ],
});

export default logger;
