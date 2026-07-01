/* eslint-disable @typescript-eslint/no-var-requires */
import type client from 'prom-client';

type PromClient = typeof client;
type MetricsModule = typeof import('../../services/metricsService');

// prom-client keeps ONE process-global registry, so these tests reset the module
// registry before each case: every fresh `require('prom-client')` then hands out a
// clean registry that is shared with the metricsService required in the same test
// (no reset in between), and is isolated from every other test.
describe('metricsService', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  // exported symbol -> the Prometheus metric name it must register under.
  const METRIC_NAMES: Record<string, string> = {
    expenseSubmissionsTotal: 'expense_submissions_total',
    expenseApprovalsTotal: 'expense_approvals_total',
    expenseResolutionSeconds: 'expense_resolution_seconds',
    apiRequestDurationSeconds: 'api_request_duration_seconds',
    apiErrorsTotal: 'api_errors_total',
  };

  it('registers every exported metric under its expected name on the shared registry', () => {
    const promClient = require('prom-client') as PromClient;
    const metrics = require('../../services/metricsService') as MetricsModule;

    for (const [exportName, metricName] of Object.entries(METRIC_NAMES)) {
      const registered = promClient.register.getSingleMetric(metricName);
      expect(registered).toBeDefined();
      // The exported handle IS the registered instance (not a detached copy).
      expect((metrics as unknown as Record<string, unknown>)[exportName]).toBe(registered);
    }

    // The module re-exports the shared default registry so /metrics scrapes it.
    expect(metrics.register).toBe(promClient.register);
  });

  it('collects the default Node.js metrics exactly once (guarded)', () => {
    const promClient = require('prom-client') as PromClient;
    require('../../services/metricsService');

    // The guard keys off this default-collector metric; its presence proves
    // collectDefaultMetrics ran without a double-registration throw.
    expect(promClient.register.getSingleMetric('process_cpu_user_seconds_total')).toBeDefined();
  });

  it('reuses an already-registered metric instead of throwing "already registered"', () => {
    // Simulate a prior import (mixed CJS/ESM, bundler dup, module-registry reset)
    // having already registered these names on the shared global registry — the
    // exact collision the get-or-create guard exists to survive. A blind
    // `new Counter(config)` would throw here (proven separately: prom-client's
    // registry rejects a duplicate name).
    const promClient = require('prom-client') as PromClient;
    const preCounter = new promClient.Counter({
      name: 'expense_submissions_total',
      help: 'pre-existing',
    });
    const preHistogram = new promClient.Histogram({
      name: 'expense_resolution_seconds',
      help: 'pre-existing',
      buckets: [1],
    });

    let metrics: MetricsModule | undefined;
    expect(() => {
      metrics = require('../../services/metricsService') as MetricsModule;
    }).not.toThrow();

    // The guard returned the pre-existing singletons, not fresh duplicates.
    expect(metrics!.expenseSubmissionsTotal).toBe(preCounter);
    expect(metrics!.expenseResolutionSeconds).toBe(preHistogram);
  });

  it('increments counters and observes histograms, recording the values', async () => {
    const metrics = require('../../services/metricsService') as MetricsModule;

    expect(() => metrics.expenseSubmissionsTotal.inc(2)).not.toThrow();
    expect(() => metrics.expenseApprovalsTotal.inc({ outcome: 'APPROVED' })).not.toThrow();
    expect(() => metrics.expenseResolutionSeconds.observe(120)).not.toThrow();

    const counter = await metrics.expenseSubmissionsTotal.get();
    expect(counter.values[0].value).toBe(2);

    const labelled = await metrics.expenseApprovalsTotal.get();
    expect(labelled.values).toContainEqual(
      expect.objectContaining({ value: 1, labels: { outcome: 'APPROVED' } }),
    );

    const histogram = await metrics.expenseResolutionSeconds.get();
    const count = histogram.values.find((v) => v.metricName === 'expense_resolution_seconds_count');
    const sum = histogram.values.find((v) => v.metricName === 'expense_resolution_seconds_sum');
    expect(count?.value).toBe(1);
    expect(sum?.value).toBe(120);
  });
});
