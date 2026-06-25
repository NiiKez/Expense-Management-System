import { Router, Request, Response } from 'express';
import pool from '../config/db';

const router = Router();

// Liveness: is the process up and the event loop responsive? Deliberately has NO
// dependencies (no DB). A liveness probe that fails on a transient DB blip would
// make an orchestrator kill and restart an otherwise-healthy app, amplifying a
// recoverable hiccup into a crash-loop. Point Kubernetes/ALB liveness probes here.
function liveness(_req: Request, res: Response): void {
  res.json({ success: true, data: { status: 'alive' } });
}

// Readiness: should this instance receive traffic right now? Verifies the DB so
// the instance drops out of the load balancer while the database is unreachable,
// then rejoins when it recovers. Point readiness probes and the Docker
// HEALTHCHECK here. Intentionally omits uptime/timestamp — those are recon
// signals on a public, unauthenticated route and aren't needed by a probe.
async function readiness(_req: Request, res: Response): Promise<void> {
  try {
    const conn = await pool.getConnection();
    conn.release();
    res.json({ success: true, data: { status: 'healthy' } });
  } catch {
    res.status(503).json({ success: false, data: { status: 'unhealthy' } });
  }
}

router.get('/live', liveness);
router.get('/ready', readiness);

// Back-compat: the original /api/v1/health is the readiness (DB-backed) check —
// matches the Docker HEALTHCHECK and existing clients.
router.get('/', readiness);

export default router;
