import type { Server as HttpServer } from 'node:http';
import type { User } from '@prisma/client';
import { Server } from 'socket.io';
import { ZodError } from 'zod';
import { isOriginAllowed } from '../config';
import { allowSocketMoveEvent, allowSocketTypingEvent } from '../middleware/rateLimit';
import { verifyJwtAndLoadUser } from '../services/authService';
import { buildForbiddenMessage, recordSecurityEvent } from '../services/securityService';
import * as taskService from '../services/taskService';
import type { Task } from '../types/domain';
import { formatZodError, socketMoveTaskSchema, socketTypingCommentSchema } from '../utils/validation';
import { registerRealtimeHooks } from './bus';

type TaskMoveAck = (response: { ok: true; task: Task } | { ok: false; error: string }) => void;

function extractHandshakeToken(authToken: unknown, authHeader: string | undefined): string | null {
  if (typeof authToken === 'string' && authToken.trim().length > 0) {
    return authToken.trim();
  }
  if (typeof authHeader === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return null;
}

export function setupSocketIO(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Origen no permitido por CORS'));
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 16 * 1024,
  });

  const onlineCounts = new Map<string, number>();

  io.use(async (socket, next) => {
    const token = extractHandshakeToken(
      socket.handshake.auth?.token,
      socket.handshake.headers.authorization,
    );

    if (!token) {
      next(new Error('unauthorized'));
      return;
    }

    try {
      const user = await verifyJwtAndLoadUser(token);
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const emitPresence = (): void => {
    io.emit('presence:update', { onlineUserIds: Array.from(onlineCounts.keys()) });
  };

  io.on('connection', (socket) => {
    const user = socket.data.user as User;
    socket.join(`user:${user.id}`);

    onlineCounts.set(user.id, (onlineCounts.get(user.id) ?? 0) + 1);
    emitPresence();

    socket.on('task:move', async (rawPayload: unknown, ack?: unknown) => {
      const respond: TaskMoveAck = (response) => {
        if (typeof ack === 'function') {
          (ack as TaskMoveAck)(response);
        }
      };

      if (!allowSocketMoveEvent(socket.id)) {
        void recordSecurityEvent({
          userId: user.id,
          username: user.username,
          eventType: 'rate_limit_hit',
          details: { source: 'socket:task:move' },
        });
        respond({
          ok: false,
          error: buildForbiddenMessage(user, 'Demasiados movimientos seguidos. Espera un momento.'),
        });
        return;
      }

      try {
        const parsed = socketMoveTaskSchema.parse(rawPayload);
        const result = await taskService.moveTask(user, parsed.taskId, {
          status: parsed.status,
          position: parsed.position,
        });
        respond({ ok: true, task: result.task });
      } catch (err) {
        let message = 'Error al mover la tarea';
        if (err instanceof ZodError) {
          message = formatZodError(err);
        } else if (err instanceof Error) {
          message = err.message;
        }
        respond({ ok: false, error: message });
      }
    });

    socket.on('comment:typing', (rawPayload: unknown) => {
      if (!allowSocketTypingEvent(socket.id)) return;
      const parsed = socketTypingCommentSchema.safeParse(rawPayload);
      if (!parsed.success) return;

      socket.broadcast.emit('comment:typing', {
        taskId: parsed.data.taskId,
        userId: user.id,
        displayName: user.displayName,
        isTyping: parsed.data.isTyping,
      });
    });

    socket.on('disconnect', () => {
      const current = onlineCounts.get(user.id) ?? 0;
      if (current <= 1) {
        onlineCounts.delete(user.id);
      } else {
        onlineCounts.set(user.id, current - 1);
      }
      emitPresence();
    });
  });

  registerRealtimeHooks({
    emitEvent: (event, payload) => {
      io.emit(event, payload);
    },
    emitUserEvent: (event, payload) => {
      io.emit(event, payload);
    },
    revokeUserSession: (userId, reason) => {
      const room = `user:${userId}`;
      io.to(room).emit('session:revoked', { reason });
      io.in(room).disconnectSockets(true);
    },
  });

  return io;
}
