import { Router } from 'express';
import { prisma } from '../prisma';
import { getMaintenanceStatus } from '../services/maintenanceService';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const time = new Date().toISOString();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const maintenance = await getMaintenanceStatus().catch(() => null);
    res.status(200).json({
      status: 'ok',
      db: true,
      maintenance: Boolean(maintenance?.active),
      time,
    });
  } catch {
    res.status(503).json({ status: 'error', db: false, maintenance: false, time });
  }
});
