import mysql from 'mysql2/promise';
import logger from './logger';

// Refuse a missing OR blank DB_PASSWORD outside the test environment.
// Why: defaulting to '' masked misconfigurations where the app silently used an
// empty password against MySQL servers that allowed it. A whitespace-only value
// is just as dangerous and slipped past the old `!DB_PASSWORD` check, so trim.
export function assertDbPasswordConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'test') return;
  if (!env.DB_PASSWORD || env.DB_PASSWORD.trim() === '') {
    throw new Error('DB_PASSWORD is required and must be non-empty (set NODE_ENV=test to run without it).');
  }
}

// Opt-in TLS for the DB connection. Default off so existing deployments (e.g. a
// DB reachable only over a private network/socket) are unchanged. When DB_SSL is
// 'true', certificate verification is ON by default; an operator can disable it
// for a self-signed/managed cert via DB_SSL_REJECT_UNAUTHORIZED=false.
export function resolveDbSsl(env: NodeJS.ProcessEnv = process.env): { rejectUnauthorized: boolean } | undefined {
  if (env.DB_SSL !== 'true') return undefined;
  return { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
}

assertDbPasswordConfigured();

const poolSize = Number(process.env.DB_POOL_SIZE) || 20;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || (process.env.NODE_ENV === 'test' ? 'root' : 'expense_app'),
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'expense_management',
  ssl: resolveDbSsl(),
  waitForConnections: true,
  connectionLimit: poolSize,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

if (process.env.NODE_ENV !== 'test') {
  // Verify connectivity on startup without adding import-time side effects to tests.
  pool.getConnection()
    .then((conn) => {
      logger.info('MySQL pool connected');
      conn.release();
    })
    .catch((err) => {
      logger.error('MySQL pool connection failed', { err });
    });
}

export default pool;
