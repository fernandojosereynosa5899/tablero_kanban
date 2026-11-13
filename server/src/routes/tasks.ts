import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireLeader, requireTaskCreator } from '../middleware/auth';
import { uploadApiLimiter } from '../middleware/rateLimit';
import { validateIdParam } from '../middleware/security';
import * as attachmentService from '../services/attachmentService';
import * as taskService from '../services/taskService';
import { MAX_ATTACHMENT_BYTES } from '../utils/fileValidation';
import {
  createCommentSchema,
  createSubtaskSchema,
  createTaskSchema,
  moveTaskSchema,
  updateTaskSchema,
} from '../utils/validation';

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_BYTES,
    files: 1,
    fields: 4,
  },
});

export const tasksRouter = Router();

tasksRouter.use(requireAuth);
tasksRouter.param('id', validateIdParam('id'));

tasksRouter.get('/', async (req, res, next) => {
  try {
    const rawAssigneeId = req.query.assigneeId;
    const assigneeId = typeof rawAssigneeId === 'string' && rawAssigneeId.trim().length > 0
      ? rawAssigneeId.trim()
      : undefined;
    const tasks = await taskService.listTasks(assigneeId);
    res.status(200).json(tasks);
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/:id', async (req, res, next) => {
  try {
    const task = await taskService.getTaskDetail(String(req.params.id));
    res.status(200).json(task);
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/', requireTaskCreator, async (req, res, next) => {
  try {
    const body = createTaskSchema.parse(req.body);
    const task = await taskService.createTask(req.user!, body);
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

tasksRouter.patch('/:id', requireLeader, async (req, res, next) => {
  try {
    const body = updateTaskSchema.parse(req.body);
    const task = await taskService.updateTask(req.user!, String(req.params.id), body);
    res.status(200).json(task);
  } catch (err) {
    next(err);
  }
});

tasksRouter.delete('/:id', requireLeader, async (req, res, next) => {
  try {
    const result = await taskService.deleteTask(req.user!, String(req.params.id));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

tasksRouter.patch('/:id/move', async (req, res, next) => {
  try {
    const body = moveTaskSchema.parse(req.body);
    const result = await taskService.moveTask(req.user!, String(req.params.id), body);
    res.status(200).json(result.task);
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/:id/subtasks', requireLeader, async (req, res, next) => {
  try {
    const body = createSubtaskSchema.parse(req.body);
    const task = await taskService.createSubtask(req.user!, String(req.params.id), body.title);
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/:id/comments', async (req, res, next) => {
  try {
    const comments = await taskService.listComments(String(req.params.id));
    res.status(200).json(comments);
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/:id/comments', async (req, res, next) => {
  try {
    const body = createCommentSchema.parse(req.body);
    const comment = await taskService.createComment(req.user!, String(req.params.id), body.content);
    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/:id/attachments', async (req, res, next) => {
  try {
    const attachments = await attachmentService.listTaskAttachments(String(req.params.id));
    res.status(200).json(attachments);
  } catch (err) {
    next(err);
  }
});

tasksRouter.post(
  '/:id/attachments',
  uploadApiLimiter,
  attachmentUpload.single('file'),
  async (req, res, next) => {
    try {
      const result = await attachmentService.uploadTaskAttachment(
        req.user!,
        String(req.params.id),
        req.file
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);
