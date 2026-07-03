import winston from 'winston';
import { PulsarLogsTransport, PulsarLogsConfig } from '../../config/pulsarLogsTransport';

// Fake fetch Response — avoids depending on a global Response in the jest env.
type FakeRes = { ok: boolean; status: number; text: () => Promise<string> };
function res(status: number, body = ''): FakeRes {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const CFG: PulsarLogsConfig = {
  url: 'https://pulsar.test/ingest-logs',
  key: 'k'.repeat(24),
  source: 'expense-management-api',
  env: 'test',
  level: 'warn',
};

function bodyOf(call: unknown[]): { source: string; env: string; logs: Record<string, unknown>[] } {
  return JSON.parse((call[1] as { body: string }).body);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('PulsarLogsTransport', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let errSpy: jest.SpyInstance;
  let transports: PulsarLogsTransport[];

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(res(200, '{"ok":true}'));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    transports = [];
  });

  afterEach(async () => {
    // flush() clears each transport's interval; guarantees no open handles.
    for (const t of transports) await t.flush().catch(() => {});
    (global as unknown as { fetch: unknown }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function makeTransport(cfg: Partial<PulsarLogsConfig> = {}): PulsarLogsTransport {
    const t = new PulsarLogsTransport({ ...CFG, ...cfg });
    transports.push(t);
    return t;
  }

  it('flush delivers a buffered line with the right payload, auth, and field mapping', async () => {
    const t = makeTransport();
    t.log(
      {
        level: 'error',
        message: 'boom',
        timestamp: '2026-07-01T00:00:00.000Z',
        requestId: 'req-1',
        service: 'expense-management-api',
        env: 'test',
        statusCode: 500,
      },
      () => {},
    );
    await t.flush(); // this is exactly what the shutdown path calls

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe(CFG.url);
    expect(opts.method).toBe('POST');
    expect(opts.headers.authorization).toBe(`Bearer ${CFG.key}`);

    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body).toMatchObject({ source: 'expense-management-api', env: 'test' });
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0]).toMatchObject({
      level: 'error',
      message: 'boom',
      ts: '2026-07-01T00:00:00.000Z',
      request_id: 'req-1',
    });
    expect(body.logs[0].metadata).toMatchObject({ statusCode: 500 });
    expect(typeof body.logs[0].dedup_key).toBe('string');
    // service/env are the batch envelope, not duplicated into per-line metadata.
    expect((body.logs[0].metadata as Record<string, unknown>).service).toBeUndefined();
  });

  it('respects the warn level cap: info is not shipped, warn/error are', async () => {
    const t = makeTransport({ level: 'warn' });
    const lg = winston.createLogger({ level: 'info', transports: [t] });
    lg.info('drop me');
    lg.warn('keep me');
    await tick();
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0]).toMatchObject({ level: 'warn', message: 'keep me' });
  });

  it('bounds the buffer when Pulsar is down — no unbounded growth (OOM)', () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const t = makeTransport();
    for (let i = 0; i < 15_000; i++) {
      t.log({ level: 'error', message: `line ${i}` }, () => {});
    }
    const queue = (t as unknown as { queue: unknown[]; dropped: number }).queue;
    expect(queue.length).toBeLessThanOrEqual(10_000);
    expect((t as unknown as { dropped: number }).dropped).toBeGreaterThan(0);
  });

  it('drops a batch on a non-retryable 401 (no infinite retry) and reports to stderr', async () => {
    fetchMock.mockResolvedValue(res(401, 'unauthorized'));
    const t = makeTransport();
    t.log({ level: 'error', message: 'x' }, () => {});
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((t as unknown as { queue: unknown[] }).queue.length).toBe(0); // dropped, not requeued
    expect(errSpy).toHaveBeenCalled(); // isolated to stderr, never back through the logger
  });

  it('requeues on 5xx and reuses the same dedup_key on retry (idempotent at-least-once)', async () => {
    fetchMock.mockResolvedValueOnce(res(500, 'boom')).mockResolvedValue(res(200, '{"ok":true}'));
    const t = makeTransport();
    t.log({ level: 'error', message: 'retry me' }, () => {});

    await t.flush(); // 500 -> requeue -> keep buffered
    expect((t as unknown as { queue: unknown[] }).queue.length).toBe(1);
    const first = bodyOf(fetchMock.mock.calls[0]);

    await t.flush(); // succeeds this time
    expect((t as unknown as { queue: unknown[] }).queue.length).toBe(0);
    const second = bodyOf(fetchMock.mock.calls[1]);

    expect(second.logs[0].dedup_key).toBe(first.logs[0].dedup_key);
  });

  it('flush drains multiple batches (more than one batch buffered)', async () => {
    const t = makeTransport();
    for (let i = 0; i < 450; i++) t.log({ level: 'error', message: `l${i}` }, () => {});
    await t.flush();

    const total = fetchMock.mock.calls.reduce((n, c) => n + bodyOf(c).logs.length, 0);
    expect(total).toBe(450);
    expect((t as unknown as { queue: unknown[] }).queue.length).toBe(0);
  });
});
