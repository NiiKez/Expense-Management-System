import { Router, Request, Response } from 'express';
import pool from '../config/db';

const router = Router();

// GET /api/v1/health — Public health check
router.get('/', async (_req: Request, res: Response) => {
  try {
    const conn = await pool.getConnection();
    conn.release();

    res.json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
    });
  } catch {
    res.status(503).json({
      success: false,
      data: {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export default router;
