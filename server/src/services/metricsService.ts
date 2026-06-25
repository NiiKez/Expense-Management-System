import client from 'prom-client';

// Default Node.js metrics (CPU, memory, event loop, GC, etc.). Guard the call:
// prom-client registers against a single global registry, so importing this
// module twice in one process (mixed CJS/ESM, a bundler duplicate, or Jest
// module-registry resets) would otherwise throw "already registered" at import
// time and hard-crash boot.
if (!client.register.getSingleMetric('process_cpu_user_seconds_total')) {
  client.collectDefaultMetrics();
}

// Get-or-create wrappers so re-importing this module reuses the existing metric
// instead of constructing a duplicate (which prom-client rejects by throwing).
function counter<T extends string>(config: client.CounterConfiguration<T>): client.Counter<T> {
  return (client.register.getSingleMetric(config.name) as client.Counter<T>) ?? new client.Counter(config);
}

function histogram<T extends string>(config: client.HistogramConfiguration<T>): client.Histogram<T> {
  return (client.register.getSingleMetric(config.name) as client.Histogram<T>) ?? new client.Histogram(config);
}

// --- Business metrics ---

export const expenseSubmissionsTotal = counter({
  name: 'expense_submissions_total',
  help: 'Total number of expense submissions',
});

export const expenseApprovalsTotal = counter({
  name: 'expense_approvals_total',
  help: 'Total number of expense approval decisions',
  labelNames: ['outcome'] as const,
});

export const expenseResolutionSeconds = histogram({
  name: 'expense_resolution_seconds',
  help: 'Time from expense submission to approval/rejection in seconds',
  buckets: [60, 300, 900, 3600, 14400, 86400, 259200, 604800],
});

// --- HTTP metrics ---

export const apiRequestDurationSeconds = histogram({
  name: 'api_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  // Top buckets cover slow Graph-API-backed paths (~10s timeout) without losing resolution.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 20],
});

export const apiErrorsTotal = counter({
  name: 'api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['status_code', 'endpoint'] as const,
});

export const register = client.register;
