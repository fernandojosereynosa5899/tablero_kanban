import { Prisma, Role, TaskStatus, type User } from '@prisma/client';
import { prisma } from '../prisma';
import { emitEvent } from '../realtime/bus';
import { buildForbiddenMessage, recordSecurityEvent } from './securityService';
import { attachmentMetaInclude, cleanupOrphanBlobs } from './attachmentService';
import {
  type Activity,
  type Comment,
  type Task,
  type TaskDetail,
  toActivityDTO,
  toAttachmentDTO,
  toCommentDTO,
  toTaskDTO,
  toUserPublic,
} from '../types/domain';
import { HttpError } from '../utils/errors';
import type { CreateTaskInput, MoveTaskInput, UpdateSubtaskInput, UpdateTaskInput } from '../utils/validation';

const taskInclude = {
  assignee: true,
  subtasks: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
  _count: {
    select: { comments: true, attachments: true },
  },
} satisfies Prisma.TaskInclude;

async function ensureAssigneeExists(assigneeId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true },
  });
  if (!user) {
    throw new HttpError(404, 'El usuario asignado no existe');
  }
}

export async function listTasks(assigneeId?: string): Promise<Task[]> {
  const tasks = await prisma.task.findMany({
    where: assigneeId ? { OR: [{ assigneeId }, { assignedToAll: true }] } : undefined,
    include: taskInclude,
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  });
  return tasks.map(toTaskDTO);
}

export async function getTaskDetail(id: string): Promise<TaskDetail> {
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      ...taskInclude,
      comments: {
        include: { author: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
      attachments: {
        include: attachmentMetaInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      },
    },
  });

  if (!task) {
    throw new HttpError(404, 'Tarea no encontrada');
  }

  return {
    ...toTaskDTO(task),
    comments: task.comments.map(toCommentDTO),
    attachments: task.attachments.map(toAttachmentDTO),
  };
}

export async function createTask(actor: User, input: CreateTaskInput): Promise<Task> {
  if (actor.role !== Role.LEADER && actor.role !== Role.SUBLEADER) {
    void recordSecurityEvent({
      userId: actor.id,
      username: actor.username,
      eventType: 'unauthorized_action',
      details: { action: 'createTask' },
    });
    throw new HttpError(403, buildForbiddenMessage(actor, 'Solo el líder o sublíder pueden agregar tareas'));
  }
  if (actor.role !== Role.LEADER && input.status === TaskStatus.APPROVED) {
    void recordSecurityEvent({
      userId: actor.id,
      username: actor.username,
      eventType: 'unauthorized_action',
      details: { action: 'createTask:APPROVED' },
    });
    throw new HttpError(403, buildForbiddenMessage(actor, 'Solo el líder puede crear o aprobar tareas en APROBADO'));
  }
  const assignAll = input.assignedToAll === true;
  const resolvedAssigneeId = assignAll ? null : (input.assigneeId ?? null);

  if (resolvedAssigneeId) {
    await ensureAssigneeExists(resolvedAssigneeId);
  }

  const { created, activity } = await prisma.$transaction(async (tx) => {
    const agg = await tx.task.aggregate({
      where: { status: input.status },
      _max: { position: true },
    });
    const position = (agg._max.position ?? 0) + 1000;

    const createdTask = await tx.task.create({
      data: {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        position,
        color: input.color ?? null,
        assigneeId: resolvedAssigneeId,
        assignedToAll: assignAll,
        createdById: actor.id,
        approvedAt: input.status === TaskStatus.APPROVED ? new Date() : null,
        subtasks: input.subtasks?.length
          ? {
              create: input.subtasks.map((title, idx) => ({
                title,
                position: idx * 1000,
              })),
            }
          : undefined,
      },
      include: taskInclude,
    });

    const log = await tx.activityLog.create({
      data: {
        userId: actor.id,
        taskId: createdTask.id,
        action: 'task.created',
        details: {
          title: createdTask.title,
          status: createdTask.status,
          assigneeId: createdTask.assigneeId,
          assignedToAll: createdTask.assignedToAll,
        },
      },
      include: { user: true },
    });

    return { created: createdTask, activity: log };
  });

  const taskDTO = toTaskDTO(created);
  emitEvent('task:created', taskDTO);
  emitEvent('activity:new', toActivityDTO(activity));
  return taskDTO;
}

export async function updateTask(actor: User, id: string, input: UpdateTaskInput): Promise<Task> {
  if (input.assignedToAll !== true && input.assigneeId !== undefined && input.assigneeId !== null) {
    await ensureAssigneeExists(input.assigneeId);
  }

  const { updated, activity } = await prisma.$transaction(async (tx) => {
    const existing = await tx.task.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpError(404, 'Tarea no encontrada');
    }

    const data: Prisma.TaskUncheckedUpdateInput = {};
    const changedFields: string[] = [];

    if (input.title !== undefined) {
      data.title = input.title;
      changedFields.push('title');
    }
    if (input.description !== undefined) {
      data.description = input.description;
      changedFields.push('description');
    }
    if (input.priority !== undefined) {
      data.priority = input.priority;
      changedFields.push('priority');
    }
    if (input.dueDate !== undefined) {
      data.dueDate = input.dueDate === null ? null : new Date(input.dueDate);
      changedFields.push('dueDate');
    }
    if (input.assignedToAll === true) {
      data.assignedToAll = true;
      data.assigneeId = null;
      changedFields.push('assignedToAll', 'assigneeId');
    } else {
      if (input.assignedToAll === false) {
        data.assignedToAll = false;
        changedFields.push('assignedToAll');
      }
      if (input.assigneeId !== undefined) {
        data.assigneeId = input.assigneeId;
        if (input.assigneeId !== null && input.assignedToAll === undefined) {
          data.assignedToAll = false;
        }
        changedFields.push('assigneeId');
      }
    }
    if (input.color !== undefined) {
      data.color = input.color;
      changedFields.push('color');
    }

    const updatedTask = await tx.task.update({
      where: { id },
      data,
      include: taskInclude,
    });

    const log = await tx.activityLog.create({
      data: {
        userId: actor.id,
        taskId: updatedTask.id,
        action: 'task.updated',
        details: {
          title: updatedTask.title,
          fields: changedFields,
        },
      },
      include: { user: true },
    });

    return { updated: updatedTask, activity: log };
  });

  const taskDTO = toTaskDTO(updated);
  emitEvent('task:updated', taskDTO);
  emitEvent('activity:new', toActivityDTO(activity));
  return taskDTO;
}

export async function deleteTask(actor: User, id: string): Promise<{ ok: true; id: string }> {
  const activity = await prisma.$transaction(async (tx) => {
    const existing = await tx.task.findUnique({
      where: { id },
      select: { id: true, title: true },
    });
    if (!existing) {
      throw new HttpError(404, 'Tarea no encontrada');
    }

    const attachedRows = await tx.taskAttachment.findMany({
      where: { taskId: id },
      select: { blobSha256: true },
    });

    await tx.task.delete({ where: { id } });

    await cleanupOrphanBlobs(
      tx,
      attachedRows.map((row) => row.blobSha256)
    );

    return tx.activityLog.create({
      data: {
        userId: actor.id,
        taskId: null,
        action: 'task.deleted',
        details: {
          deletedTaskId: id,
          title: existing.title,
        },
      },
      include: { user: true },
    });
  });

  emitEvent('task:deleted', { id });
  emitEvent('activity:new', toActivityDTO(activity));
  return { ok: true, id };
}

export async function moveTask(
  actor: User,
  taskId: string,
  input: MoveTaskInput,
): Promise<{ task: Task; fromStatus: TaskStatus; toStatus: TaskStatus }> {
  const { updated, fromStatus, enteringApproved, activity } = await prisma.$transaction(async (tx) => {
    const existing = await tx.task.findUnique({ where: { id: taskId } });
    if (!existing) {
      throw new HttpError(404, 'Tarea no encontrada');
    }

    if (actor.role !== Role.LEADER) {
      if (!existing.assignedToAll && existing.assigneeId !== actor.id) {
        void recordSecurityEvent({
          userId: actor.id,
          username: actor.username,
          eventType: 'unauthorized_action',
          details: { action: 'moveTask:notAssignee', taskId },
        });
        throw new HttpError(403, buildForbiddenMessage(actor, 'Solo puedes mover tus tareas asignadas'));
      }
      if (existing.status === TaskStatus.APPROVED || input.status === TaskStatus.APPROVED) {
        void recordSecurityEvent({
          userId: actor.id,
          username: actor.username,
          eventType: 'unauthorized_action',
          details: { action: 'moveTask:APPROVED', taskId, from: existing.status, to: input.status },
        });
        throw new HttpError(403, buildForbiddenMessage(actor, 'Solo el líder puede aprobar tareas'));
      }
    }

    let newPosition = input.position;
    if (newPosition === undefined) {
      const agg = await tx.task.aggregate({
        where: { status: input.status, NOT: { id: taskId } },
        _max: { position: true },
      });
      newPosition = agg._max.position === null ? 0 : agg._max.position + 1000;
    }

    const nowApproved = input.status === TaskStatus.APPROVED && existing.status !== TaskStatus.APPROVED;
    const approvedAt =
      input.status === TaskStatus.APPROVED ? (nowApproved ? new Date() : existing.approvedAt ?? new Date()) : null;

    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: {
        status: input.status,
        position: newPosition,
        approvedAt,
      },
      include: taskInclude,
    });

    const log = await tx.activityLog.create({
      data: {
        userId: actor.id,
        taskId: updatedTask.id,
        action: nowApproved ? 'task.approved' : 'task.moved',
        details: {
          title: updatedTask.title,
          fromStatus: existing.status,
          toStatus: input.status,
        },
      },
      include: { user: true },
    });

    return {
      updated: updatedTask,
      fromStatus: existing.status,
      enteringApproved: nowApproved,
      activity: log,
    };
  });

  const taskDTO = toTaskDTO(updated);
  const actorPublic = toUserPublic(actor);

  emitEvent('task:moved', {
    task: taskDTO,
    fromStatus,
    toStatus: input.status,
    by: actorPublic,
  });

  if (enteringApproved) {
    emitEvent('task:approved', {
      task: taskDTO,
      by: actorPublic,
    });
  }

  emitEvent('activity:new', toActivityDTO(activity));

  return {
    task: taskDTO,
    fromStatus,
    toStatus: input.status,
  };
}

export async function createSubtask(_actor: User, taskId: string, title: string): Promise<Task> {
  const updatedTask = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) {
      throw new HttpError(404, 'Tarea no encontrada');
    }

    const agg = await tx.subtask.aggregate({
      where: { taskId },
      _max: { position: true },
    });
    const position = agg._max.position === null ? 0 : agg._max.position + 1000;

    await tx.subtask.create({
      data: {
        taskId,
        title,
        position,
      },
    });

    return tx.task.findUniqueOrThrow({
      where: { id: taskId },
      include: taskInclude,
    });
  });

  const taskDTO = toTaskDTO(updatedTask);
  emitEvent('task:updated', taskDTO);
  return taskDTO;
}

export async function updateSubtask(actor: User, subtaskId: string, input: UpdateSubtaskInput): Promise<Task> {
  const { updatedTask, activity } = await prisma.$transaction(async (tx) => {
    const subtask = await tx.subtask.findUnique({
      where: { id: subtaskId },
      include: {
        task: {
          select: { id: true, title: true, assigneeId: true, assignedToAll: true },
        },
      },
    });

    if (!subtask) {
      throw new HttpError(404, 'Subtarea no encontrada');
    }

    if (input.title !== undefined && actor.role !== Role.LEADER) {
      void recordSecurityEvent({
        userId: actor.id,
        username: actor.username,
        eventType: 'unauthorized_action',
        details: { action: 'updateSubtask:title', subtaskId },
      });
      throw new HttpError(403, buildForbiddenMessage(actor, 'Solo el líder puede editar el título de la subtarea'));
    }

    if (
      input.done !== undefined &&
      actor.role !== Role.LEADER &&
      !subtask.task.assignedToAll &&
      subtask.task.assigneeId !== actor.id
    ) {
      void recordSecurityEvent({
        userId: actor.id,
        username: actor.username,
        eventType: 'unauthorized_action',
        details: { action: 'updateSubtask:done', subtaskId },
      });
      throw new HttpError(
        403,
        buildForbiddenMessage(actor, 'Solo el líder o el usuario asignado puede marcar esta subtarea'),
      );
    }

    const data: Prisma.SubtaskUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.done !== undefined) data.done = input.done;

    const updatedSubtask = await tx.subtask.update({
      where: { id: subtaskId },
      data,
    });

    let log: (Prisma.ActivityLogGetPayload<{ include: { user: true } }>) | null = null;
    if (input.done !== undefined && input.done !== subtask.done) {
      log = await tx.activityLog.create({
        data: {
          userId: actor.id,
          taskId: subtask.taskId,
          action: 'subtask.toggled',
          details: {
            taskTitle: subtask.task.title,
            subtaskId,
            title: updatedSubtask.title,
            done: updatedSubtask.done,
          },
        },
        include: { user: true },
      });
    }

    const parentTask = await tx.task.findUniqueOrThrow({
      where: { id: subtask.taskId },
      include: taskInclude,
    });

    return { updatedTask: parentTask, activity: log };
  });

  const taskDTO = toTaskDTO(updatedTask);
  emitEvent('task:updated', taskDTO);
  if (activity) {
    emitEvent('activity:new', toActivityDTO(activity));
  }
  return taskDTO;
}

export async function deleteSubtask(_actor: User, subtaskId: string): Promise<Task> {
  const updatedTask = await prisma.$transaction(async (tx) => {
    const subtask = await tx.subtask.findUnique({
      where: { id: subtaskId },
      select: { id: true, taskId: true },
    });
    if (!subtask) {
      throw new HttpError(404, 'Subtarea no encontrada');
    }

    await tx.subtask.delete({ where: { id: subtaskId } });

    return tx.task.findUniqueOrThrow({
      where: { id: subtask.taskId },
      include: taskInclude,
    });
  });

  const taskDTO = toTaskDTO(updatedTask);
  emitEvent('task:updated', taskDTO);
  return taskDTO;
}

export async function listComments(taskId: string): Promise<Comment[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });
  if (!task) {
    throw new HttpError(404, 'Tarea no encontrada');
  }

  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: { author: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return comments.map(toCommentDTO);
}

export async function createComment(actor: User, taskId: string, content: string): Promise<Comment> {
  const { created, activity } = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true },
    });
    if (!task) {
      throw new HttpError(404, 'Tarea no encontrada');
    }

    const comment = await tx.comment.create({
      data: {
        taskId,
        authorId: actor.id,
        content,
      },
      include: { author: true },
    });

    const log = await tx.activityLog.create({
      data: {
        userId: actor.id,
        taskId,
        action: 'comment.created',
        details: {
          title: task.title,
          content,
        },
      },
      include: { user: true },
    });

    return { created: comment, activity: log };
  });

  const commentDTO = toCommentDTO(created);
  emitEvent('comment:created', { taskId, comment: commentDTO });
  emitEvent('activity:new', toActivityDTO(activity));
  return commentDTO;
}

export async function deleteComment(
  actor: User,
  commentId: string,
): Promise<{ ok: true; id: string; taskId: string }> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, taskId: true, authorId: true },
  });

  if (!comment) {
    throw new HttpError(404, 'Comentario no encontrado');
  }

  if (actor.role !== Role.LEADER && comment.authorId !== actor.id) {
    void recordSecurityEvent({
      userId: actor.id,
      username: actor.username,
      eventType: 'unauthorized_action',
      details: { action: 'deleteComment', commentId },
    });
    throw new HttpError(
      403,
      buildForbiddenMessage(actor, 'Solo el autor o el líder pueden eliminar este comentario'),
    );
  }

  await prisma.comment.delete({ where: { id: commentId } });
  emitEvent('comment:deleted', { taskId: comment.taskId, id: commentId });
  return { ok: true, id: commentId, taskId: comment.taskId };
}

export async function listActivity(limit = 30, includeSecurity = false): Promise<Activity[]> {
  const clamped = Number.isFinite(limit) ? Math.min(Math.max(1, Math.trunc(limit)), 100) : 30;
  const rows = await prisma.activityLog.findMany({
    take: clamped,
    where: includeSecurity ? undefined : { NOT: { action: 'security.alert' } },
    orderBy: { createdAt: 'desc' },
    include: { user: true },
  });
  return rows.map(toActivityDTO);
}
