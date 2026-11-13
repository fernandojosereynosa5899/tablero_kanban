import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireLeader } from '../middleware/auth';
import {
  getMaintenanceStatus,
  updateDatabaseMaintenanceMode,
} from '../services/maintenanceService';

const updateMaintenanceSchema = z.object({
  enabled: z.boolean({ message: 'El campo enabled debe ser booleano' }),
  title: z
    .string({ message: 'El título debe ser texto' })
    .trim()
    .min(3, 'El título debe tener al menos 3 caracteres')
    .max(100, 'El título no puede superar 100 caracteres')
    .optional(),
  message: z
    .string({ message: 'El mensaje debe ser texto' })
    .trim()
    .min(5, 'El mensaje debe tener al menos 5 caracteres')
    .max(400, 'El mensaje no puede superar 400 caracteres')
    .optional(),
  estimatedMinutes: z
    .number({ message: 'El tiempo estimado debe ser un número' })
    .int('El tiempo estimado debe ser un número entero')
    .min(1, 'El tiempo estimado debe ser de al menos 1 minuto')
    .max(1440, 'El tiempo estimado no puede superar 1440 minutos')
    .nullable()
    .optional(),
});

export const maintenanceRouter = Router();

maintenanceRouter.get('/status', async (_req, res, next) => {
  try {
    const status = await getMaintenanceStatus();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(status);
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.patch('/', requireAuth, requireLeader, async (req, res, next) => {
  try {
    const parsed = updateMaintenanceSchema.parse(req.body);
    const updated = await updateDatabaseMaintenanceMode(req.user!, parsed);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});
