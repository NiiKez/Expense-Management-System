import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import expressWinston from 'express-winston';
import logger, { generateCorrelationId } from './config/logger';
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
import authRoutes from './routes/auth';

const app = express();

app.disable('x-powered-by');

// Security headers. In the combined single-image deploy this app also serves the
// built SPA (index.html), so the CSP governs the page itself — not just JSON
// responses. Keep a strict default-src 'none', but allow the SPA to reach its own
// origin (connect-src 'self' — required for every XHR/fetch, including the public
// demo) and let MSAL talk to Entra for sign-in (token/metadata over connect-src,
// the silent-token iframe over frame-src). Bundled JS/CSS are same-origin, so
// helmet's default script/style/img/font directives still apply. CORP stays
// same-site so API-served assets load; framing is forbidden (clickjacking).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      // The hash whitelists the inline theme-init script in client/index.html
      // (a flash-of-wrong-theme guard that runs before first paint); without it
      // the strict CSP blocks the script and dark-mode users get a light flash.
      scriptSrc: ["'self'", "'sha256-t1DzxWa0f4hvmUQzW8bYVGjrn8jzPwosACO6pQNpxLY='"],
      connectSrc: ["'self'", 'https://login.microsoftonline.com'],
      frameSrc: ['https://login.microsoftonline.com'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
}));

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

// Request correlation. Honor an upstream X-Request-Id (gateway/load balancer)
// when present and sane, otherwise mint one; echo it back so a client can quote
// the id of a failing request. Runs before request logging so access logs carry it.
app.use((req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.length <= 200 ? incoming : generateCorrelationId();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
});

// Static assets the SPA serves in bulk — a single page load fans out to dozens of
// these. Matching on file extension lets the skip() below drop only the successful
// ones from the access log.
const STATIC_ASSET_RE = /\.(?:js|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|txt)$/i;

// Request logging — correlate each access log line with the request id (and, once
// auth has run, the authenticated user), without dumping request/response headers
// or bodies into the logs.
app.use(expressWinston.logger({
  winstonInstance: logger,
  meta: true,
  expressFormat: true,
  requestWhitelist: [],
  responseWhitelist: [],
  // Severity tracks HTTP status so alerts/queries key off log level instead of
  // parsing the status code: 5xx => error, 4xx => warn, everything else => info.
  level: (_req, res) => {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Drop only SUCCESSFUL noise. Otherwise every static-asset fetch and every
  // liveness/readiness probe becomes an ingested Log Analytics line (cost + noise).
  // The `< 400` guard means a failing asset or health request is STILL logged, so
  // we never hide failures behind the filter.
  skip: (req, res) =>
    res.statusCode < 400 &&
    (req.path.startsWith('/api/v1/health') || STATIC_ASSET_RE.test(req.path)),
  // dynamicMeta is evaluated at response 'finish'. This logger is registered before
  // the auth middleware, but by the time the response finishes auth has populated
  // req.user — so the id/role attach here. Internal id/role only: no email, no token.
  dynamicMeta: (req) => ({
    requestId: req.id,
    userId: req.user?.id,
    role: req.user?.role,
  }),
}));

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
  // Never rate-limit liveness: a 429 to /live reads as a liveness failure and
  // makes the orchestrator kill an otherwise-healthy instance — the crash-loop
  // amplification the liveness/readiness split exists to prevent. The endpoint
  // is dependency-free and cheap, so leaving it unthrottled is safe. Readiness
  // (DB-backed) and the legacy aggregate stay limited.
  skip: (req) => req.path === '/live',
});

// Demo workspace creation seeds a whole sandbox, so keep /auth/demo-login on its
// own tight per-IP budget, independent of the general API limiter.
const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.DEMO_RATE_LIMIT_MAX) || 10,
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
app.use('/api/v1/auth', demoLimiter, authRoutes); // public: demo-login (no auth)
app.use('/api/v1/me', meRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/approvals', strictLimiter, approvalRoutes);
app.use('/api/v1/manager', managerRoutes);
app.use('/api/v1/admin', strictLimiter, adminRoutes);

// Unmatched API routes always return a JSON 404 — never the SPA shell. apiLimiter
// also throttles probes to nonexistent /api paths (helmet + parsing + logging).
app.use('/api', apiLimiter, (_req, _res, next) => {
  next(notFound('Route'));
});

// Combined-container deploy: the API also serves the built client. When the
// bundle is absent (dev/test, or an API-only image) this is skipped and non-API
// routes fall through to the throttled JSON 404 below (prior behavior).
const clientDistPath = process.env.CLIENT_DIST_PATH
  ? path.resolve(process.env.CLIENT_DIST_PATH)
  : path.join(__dirname, '..', '..', 'client-dist');
const clientIndexHtml = path.join(clientDistPath, 'index.html');

if (fs.existsSync(clientIndexHtml)) {
  app.use(express.static(clientDistPath));
  // SPA fallback: serve index.html for non-API client routes so React Router
  // can resolve them. Express 5 rejects a bare '*' path, so use a path-less
  // terminal handler and answer GETs only.
  app.use(apiLimiter, (req, res, next) => {
    if (req.method !== 'GET') {
      next(notFound('Route'));
      return;
    }
    res.sendFile(clientIndexHtml);
  });
} else {
  // No client bundle: throttle and 404 unmatched routes (outside /api/v1 too).
  app.use(apiLimiter, (_req, _res, next) => {
    next(notFound('Route'));
  });
}

// Global error handler (must be after routes)
app.use(errorHandler);

export default app;
