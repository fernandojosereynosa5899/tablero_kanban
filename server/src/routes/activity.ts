import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as taskService from '../services/taskService';

export const activityRouter = Router();

activityRouter.use(requireAuth);

activityRouter.get('/', async (req, res, next) => {
  try {
    const rawLimit = req.query.limit;
    const parsedLimit = typeof rawLimit === 'string' && rawLimit.trim().length > 0 ? Number(rawLimit) : 30;
    const items = await taskService.listActivity(parsedLimit, req.user?.role === 'LEADER');
    res.status(200).json(items);
  } catch (err) {
    next(err);
  }
});
