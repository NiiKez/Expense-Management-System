import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import expressWinston from 'express-winston';
import logger from './config/logger';
import { errorHandler } from './middleware/errorHandler';
import { metricsMiddleware } from './middleware/metrics';
import { forbidden, notFound } from './utils/errors';
import expenseRoutes from './routes/expenses';
import approvalRoutes from './routes/approvals';
import adminRoutes from './routes/admin';
import healthRoutes from './routes/health';
import meRoutes from './routes/me';
import managerRoutes from './routes/manager';
import notificationRoutes from './routes/notifications';

const app = express();

app.disable('x-powered-by');

// Security headers
app.use(helmet());

// Trust proxy hop count.
// Why exact: 'true' trusts the entire X-Forwarded-For chain, letting any client
// spoof their IP. Set TRUST_PROXY_HOPS to the number of proxies in front of the
// app (e.g. 1 for a single ALB, 2 for CDN→ALB).
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
} else if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// CORS — restrict to configured origin
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      // Server-to-server / curl / same-origin preflight-less requests.
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    // Reject explicitly so the request short-circuits with a clear error,
    // and log so misconfigurations surface in monitoring.
    logger.warn('Rejected CORS origin', { origin });
    callback(forbidden('Origin not allowed'));
  },
  credentials: allowedOrigins.length > 0,
}));

// Request logging
app.use(expressWinston.logger({ winstonInstance: logger, meta: false, expressFormat: true }));

// Body parsing
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100kb' }));

// Metrics collection
app.use(metricsMiddleware);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 1_000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: true, xForwardedForHeader: true },
});

// Rate limiting for sensitive routes
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.STRICT_RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: true, xForwardedForHeader: true },
});

const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.HEALTH_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: true, xForwardedForHeader: true },
});

// Prometheus metrics are served on a separate internal listener — see server.ts.
// Keeping /metrics off the main app prevents it from being exposed to the
// internet (the main port is public) and removes the auth requirement that
// blocked Prometheus from scraping.

// Routes
app.use('/api/v1/health', healthLimiter, healthRoutes);
app.use('/api/v1', apiLimiter);
app.use('/api/v1/me', meRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/approvals', strictLimiter, approvalRoutes);
app.use('/api/v1/manager', managerRoutes);
app.use('/api/v1/admin', strictLimiter, adminRoutes);

// Throttle unmatched routes too. Without apiLimiter here, requests to paths
// outside /api/v1 (e.g. '/', '/favicon.ico', probes) reach the 404 handler with
// no rate limit, letting an attacker cheaply flood helmet + body parsing + logging.
app.use(apiLimiter, (_req, _res, next) => {
  next(notFound('Route'));
});

// Global error handler (must be after routes)
app.use(errorHandler);

export default app;
