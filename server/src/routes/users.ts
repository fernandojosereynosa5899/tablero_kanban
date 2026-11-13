import { Router } from 'express';
import { Prisma, Role } from '@prisma/client';
import { requireAuth, requireLeader } from '../middleware/auth';
import { validateIdParam } from '../middleware/security';
import { prisma } from '../prisma';
import { emitUserEvent, revokeUserSession } from '../realtime/bus';
import { hashPassword, signAuthToken, verifyPassword } from '../services/authService';
import { DEFAULT_AVATAR, MAX_USERS, toUserPublic } from '../types/domain';
import { HttpError } from '../utils/errors';
import {
  changeMyPasswordSchema,
  createUserSchema,
  updateMeSchema,
  updateUserSchema,
} from '../utils/validation';

export const usersRouter = Router();

const MEMBER_SLOTS = [2, 3, 4, 5, 6] as const;

usersRouter.use(requireAuth);
usersRouter.param('id', validateIdParam('id'));

usersRouter.get('/me', (req, res) => {
  res.status(200).json(toUserPublic(req.user!));
});

usersRouter.patch('/me', async (req, res, next) => {
  try {
    const currentUser = req.user!;
    const body = updateMeSchema.parse(req.body);

    const data: Prisma.UserUpdateInput = {};
    const changedFields: string[] = [];

    if (body.displayName !== undefined) {
      data.displayName = body.displayName;
      changedFields.push('displayName');
    }
    if (body.avatar !== undefined) {
      data.avatar = body.avatar as unknown as Prisma.InputJsonValue;
      changedFields.push('avatar');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: currentUser.id },
        data,
      });
      await tx.activityLog.create({
        data: {
          userId: currentUser.id,
          action: 'user.updated',
          details: { targetUserId: currentUser.id, fields: changedFields },
        },
      });
      return user;
    });

    const userPublic = toUserPublic(updated);
    emitUserEvent('user:updated', userPublic);
    res.status(200).json(userPublic);
  } catch (err) {
    next(err);
  }
});

usersRouter.patch('/me/password', async (req, res, next) => {
  try {
    const currentUser = req.user!;
    const { currentPassword, newPassword } = changeMyPasswordSchema.parse(req.body);

    const matches = await verifyPassword(currentPassword, currentUser.passwordHash);
    if (!matches) {
      res.status(400).json({ error: 'La contraseña actual es incorrecta' });
      return;
    }

    const newHash = await hashPassword(newPassword);

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: currentUser.id },
        data: {
          passwordHash: newHash,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.activityLog.create({
        data: {
          userId: currentUser.id,
          action: 'user.updated',
          details: { targetUserId: currentUser.id, fields: ['password'] },
        },
      });
      return user;
    });

    revokeUserSession(currentUser.id, 'Tu contraseña ha sido actualizada');
    const token = signAuthToken(updated);
    res.status(200).json({ ok: true, token });
  } catch (err) {
    next(err);
  }
});

usersRouter.get('/', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { slot: 'asc' },
    });
    res.status(200).json({
      users: users.map(toUserPublic),
      maxUsers: MAX_USERS,
    });
  } catch (err) {
    next(err);
  }
});

usersRouter.post('/', requireLeader, async (req, res, next) => {
  try {
    const actor = req.user!;
    const body = createUserSchema.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const avatar = (body.avatar ?? DEFAULT_AVATAR) as unknown as Prisma.InputJsonValue;

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findMany({
        orderBy: { slot: 'asc' },
        select: { id: true, slot: true, username: true },
      });

      if (existing.some((u) => u.username.toLowerCase() === body.username)) {
        throw new HttpError(409, 'La clave de usuario ya existe');
      }

      if (existing.length >= MAX_USERS) {
        throw new HttpError(409, 'Límite máximo de 6 usuarios alcanzado');
      }

      const usedSlots = new Set(existing.map((u) => u.slot));
      const freeSlot = MEMBER_SLOTS.find((slot) => !usedSlots.has(slot));
      if (freeSlot === undefined) {
        throw new HttpError(409, 'Límite máximo de 6 usuarios alcanzado');
      }

      const user = await tx.user.create({
        data: {
          username: body.username,
          passwordHash,
          displayName: body.displayName,
          role: Role.MEMBER,
          avatar,
          slot: freeSlot,
        },
      });

      await tx.activityLog.create({
        data: {
          userId: actor.id,
          action: 'user.created',
          details: {
            targetUserId: user.id,
            username: user.username,
            displayName: user.displayName,
            slot: user.slot,
          },
        },
      });

      return user;
    });

    const userPublic = toUserPublic(created);
    emitUserEvent('user:created', userPublic);
    res.status(201).json(userPublic);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target ?? '');
      if (target.includes('username')) {
        next(new HttpError(409, 'La clave de usuario ya existe'));
        return;
      }
      if (target.includes('slot')) {
        next(new HttpError(409, 'Límite máximo de 6 usuarios alcanzado'));
        return;
      }
    }
    next(err);
  }
});

usersRouter.patch('/:id', requireLeader, async (req, res, next) => {
  try {
    const actor = req.user!;
    const targetId = String(req.params.id);
    const body = updateUserSchema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new HttpError(404, 'Usuario no encontrado');
    }

    const data: Prisma.UserUpdateInput = {};
    const changedFields: string[] = [];

    if (body.username !== undefined && body.username !== target.username) {
      const duplicate = await prisma.user.findFirst({
        where: {
          username: { equals: body.username, mode: 'insensitive' },
          NOT: { id: targetId },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpError(409, 'La clave de usuario ya existe');
      }
      data.username = body.username;
      changedFields.push('username');
    }

    if (body.displayName !== undefined) {
      data.displayName = body.displayName;
      changedFields.push('displayName');
    }

    if (body.avatar !== undefined) {
      data.avatar = body.avatar as unknown as Prisma.InputJsonValue;
      changedFields.push('avatar');
    }

    const passwordReset = body.password !== undefined;
    if (body.password !== undefined) {
      data.passwordHash = await hashPassword(body.password);
      data.tokenVersion = { increment: 1 };
      changedFields.push('password');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetId },
        data,
      });
      await tx.activityLog.create({
        data: {
          userId: actor.id,
          action: 'user.updated',
          details: { targetUserId: targetId, fields: changedFields },
        },
      });
      return user;
    });

    if (passwordReset) {
      revokeUserSession(targetId, 'Tu contraseña ha sido restablecida por el líder');
    }

    const userPublic = toUserPublic(updated);
    emitUserEvent('user:updated', userPublic);
    res.status(200).json(userPublic);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target ?? '');
      if (target.includes('username')) {
        next(new HttpError(409, 'La clave de usuario ya existe'));
        return;
      }
    }
    next(err);
  }
});

usersRouter.delete('/:id', requireLeader, async (req, res, next) => {
  try {
    const actor = req.user!;
    const targetId = String(req.params.id);

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new HttpError(404, 'Usuario no encontrado');
    }

    if (target.role === Role.LEADER || target.id === actor.id) {
      throw new HttpError(403, 'No se puede eliminar al líder del proyecto');
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: targetId } });
      await tx.activityLog.create({
        data: {
          userId: actor.id,
          action: 'user.deleted',
          details: {
            targetUserId: targetId,
            username: target.username,
            displayName: target.displayName,
            slot: target.slot,
          },
        },
      });
    });

    revokeUserSession(targetId, 'Tu cuenta ha sido eliminada');
    emitUserEvent('user:deleted', { id: targetId });
    res.status(200).json({ ok: true, id: targetId });
  } catch (err) {
    next(err);
  }
});
