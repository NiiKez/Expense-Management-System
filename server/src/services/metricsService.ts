import client from 'prom-client';

// Collect default Node.js metrics (CPU, memory, event loop, GC, etc.)
client.collectDefaultMetrics();

// --- Business metrics ---

export const expenseSubmissionsTotal = new client.Counter({
  name: 'expense_submissions_total',
  help: 'Total number of expense submissions',
});

export const expenseApprovalsTotal = new client.Counter({
  name: 'expense_approvals_total',
  help: 'Total number of expense approval decisions',
  labelNames: ['outcome'] as const,
});

export const expenseResolutionSeconds = new client.Histogram({
  name: 'expense_resolution_seconds',
  help: 'Time from expense submission to approval/rejection in seconds',
  buckets: [60, 300, 900, 3600, 14400, 86400, 259200, 604800],
});

// --- HTTP metrics ---

export const apiRequestDurationSeconds = new client.Histogram({
  name: 'api_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  // Top buckets cover slow Graph-API-backed paths (~10s timeout) without losing resolution.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 20],
});

export const apiErrorsTotal = new client.Counter({
  name: 'api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['status_code', 'endpoint'] as const,
});

export const register = client.register;
