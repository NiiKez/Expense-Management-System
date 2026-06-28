import logger from '../../config/logger';

// defaultMeta is the base context stamped onto every log line so a shared Log
// Analytics workspace can be filtered by app/environment/release. Guard against a
// regression that drops or renames these fields (which would silently break the
// dashboards/queries that key off them).
describe('logger defaultMeta', () => {
  it('stamps a stable service name on every line', () => {
    expect(logger.defaultMeta).toMatchObject({ service: 'expense-management-api' });
  });

  it('carries the environment and a non-empty version', () => {
    expect(logger.defaultMeta?.env).toBe(process.env.NODE_ENV ?? 'development');
    expect(typeof logger.defaultMeta?.version).toBe('string');
    expect(logger.defaultMeta?.version.length).toBeGreaterThan(0);
  });
});
