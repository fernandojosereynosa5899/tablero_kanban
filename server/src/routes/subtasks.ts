import { Router } from 'express';
import { requireAuth, requireLeader } from '../middleware/auth';
import { validateIdParam } from '../middleware/security';
import * as taskService from '../services/taskService';
import { updateSubtaskSchema } from '../utils/validation';

export const subtasksRouter = Router();
export const commentsRouter = Router();

subtasksRouter.use(requireAuth);
commentsRouter.use(requireAuth);
subtasksRouter.param('id', validateIdParam('id'));
commentsRouter.param('id', validateIdParam('id'));

subtasksRouter.patch('/:id', async (req, res, next) => {
  try {
    const body = updateSubtaskSchema.parse(req.body);
    const task = await taskService.updateSubtask(req.user!, String(req.params.id), body);
    res.status(200).json(task);
  } catch (err) {
    next(err);
  }
});

subtasksRouter.delete('/:id', requireLeader, async (req, res, next) => {
  try {
    const task = await taskService.deleteSubtask(req.user!, String(req.params.id));
    res.status(200).json(task);
  } catch (err) {
    next(err);
  }
});

commentsRouter.delete('/:id', async (req, res, next) => {
  try {
    const result = await taskService.deleteComment(req.user!, String(req.params.id));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
