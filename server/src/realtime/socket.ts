import type { Server as HttpServer } from 'node:http';
import type { User } from '@prisma/client';
import { Server } from 'socket.io';
import { ZodError } from 'zod';
import { isOriginAllowed } from '../config';
import {
  allowSocketMoveEvent,
  allowSocketTypingEvent,
  clearSocketRateLimits,
} from '../middleware/rateLimit';
import { verifyJwtAndLoadUser } from '../services/authService';
import { getMaintenanceStatus } from '../services/maintenanceService';
import { buildForbiddenMessage, recordSecurityEvent } from '../services/securityService';
import * as taskService from '../services/taskService';
import type { MaintenanceStatus, Task } from '../types/domain';
import { formatZodError, socketMoveTaskSchema, socketTypingCommentSchema } from '../utils/validation';
import { registerRealtimeHooks } from './bus';

type TaskMoveAck = (response: { ok: true; task: Task } | { ok: false; error: string }) => void;

const BOARD_EVENTS = new Set([
  'task:created',
  'task:updated',
  'task:deleted',
  'task:moved',
  'task:approved',
  'comment:created',
  'comment:deleted',
  'attachment:created',
  'attachment:deleted',
  'activity:new',
]);

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
  let maintenanceBroadcastActive = false;

  io.use(async (socket, next) => {
    const token = extractHandshakeToken(
      socket.handshake.auth?.token,
      socket.handshake.headers.authorization,
    );

    if (!token) {
      next(new Error('unauthorized'));
      return;
    }

    let user: User;
    try {
      user = await verifyJwtAndLoadUser(token);
    } catch {
      next(new Error('unauthorized'));
      return;
    }

    const maintenance = await getMaintenanceStatus().catch(() => null);
    if (maintenance) {
      maintenanceBroadcastActive = maintenance.active;
    }
    if (maintenance?.active && user.role !== 'LEADER') {
      next(new Error('maintenance'));
      return;
    }

    socket.data.user = user;
    socket.data.revoked = false;
    next();
  });

  const emitPresence = (): void => {
    const payload = { onlineUserIds: Array.from(onlineCounts.keys()) };
    if (maintenanceBroadcastActive) {
      io.to('role:LEADER').emit('presence:update', payload);
      return;
    }
    io.emit('presence:update', payload);
  };

  const scheduleNonLeaderMaintenanceDisconnect = (): void => {
    const nonLeaderSockets = Array.from(io.sockets.sockets.values()).filter((s) => {
      const socketUser = s.data.user as User | undefined;
      return socketUser?.role !== 'LEADER';
    });
    if (nonLeaderSockets.length === 0) return;

    const timer = setTimeout(() => {
      if (!maintenanceBroadcastActive) return;
      for (const s of nonLeaderSockets) {
        if (s.connected) {
          s.disconnect(true);
        }
      }
    }, 100);
    timer.unref();
  };

  io.on('connection', (socket) => {
    const user = socket.data.user as User;
    socket.data.revoked = false;
    socket.join(`user:${user.id}`);
    socket.join(`role:${user.role}`);

    onlineCounts.set(user.id, (onlineCounts.get(user.id) ?? 0) + 1);
    emitPresence();

    socket.on('task:move', async (rawPayload: unknown, ack?: unknown) => {
      const respond: TaskMoveAck = (response) => {
        if (typeof ack === 'function') {
          (ack as TaskMoveAck)(response);
        }
      };

      if (socket.data.revoked === true) {
        respond({ ok: false, error: 'Sesión revocada' });
        return;
      }

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

      const maintenance = await getMaintenanceStatus().catch(() => null);
      if (maintenance) {
        maintenanceBroadcastActive = maintenance.active;
      }
      if (maintenance?.active && user.role !== 'LEADER') {
        respond({ ok: false, error: maintenance.message });
        return;
      }

      if (socket.data.revoked === true) {
        respond({ ok: false, error: 'Sesión revocada' });
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

    socket.on('comment:typing', async (rawPayload: unknown) => {
      try {
        if (socket.data.revoked === true) return;
        if (!allowSocketTypingEvent(socket.id)) return;
        const parsed = socketTypingCommentSchema.safeParse(rawPayload);
        if (!parsed.success) return;

        const maintenance = await getMaintenanceStatus().catch(() => null);
        if (maintenance) {
          maintenanceBroadcastActive = maintenance.active;
        }
        if (maintenance?.active && user.role !== 'LEADER') return;
        if (socket.data.revoked === true || !socket.connected) return;

        const payload = {
          taskId: parsed.data.taskId,
          userId: user.id,
          displayName: user.displayName,
          isTyping: parsed.data.isTyping,
        };

        if (maintenance?.active) {
          socket.broadcast.to('role:LEADER').emit('comment:typing', payload);
          return;
        }
        socket.broadcast.emit('comment:typing', payload);
      } catch {
        // Ignorar errores transitorios en evento efímero de escritura
      }
    });

    socket.on('disconnect', () => {
      clearSocketRateLimits(socket.id);
      const current = onlineCounts.get(user.id) ?? 0;
      if (current <= 1) {
        onlineCounts.delete(user.id);
      } else {
        onlineCounts.set(user.id, current - 1);
      }
      emitPresence();
    });

    void getMaintenanceStatus()
      .then((status) => {
        maintenanceBroadcastActive = status.active;
        if (!socket.connected) return;
        socket.emit('maintenance:updated', status);
        if (status.active && user.role !== 'LEADER') {
          const timer = setTimeout(() => {
            if (maintenanceBroadcastActive && socket.connected) {
              socket.disconnect(true);
            }
          }, 100);
          timer.unref();
        }
      })
      .catch(() => {});
  });

  registerRealtimeHooks({
    emitEvent: (event, payload) => {
      if (event === 'maintenance:updated') {
        const status = payload as MaintenanceStatus;
        maintenanceBroadcastActive = status.active;
        io.emit('maintenance:updated', status);
        if (status.active) {
          scheduleNonLeaderMaintenanceDisconnect();
        }
        return;
      }

      if (maintenanceBroadcastActive && BOARD_EVENTS.has(event)) {
        io.to('role:LEADER').emit(event, payload);
        return;
      }

      io.emit(event, payload);
    },
    emitUserEvent: (event, payload) => {
      if (maintenanceBroadcastActive) {
        io.to('role:LEADER').emit(event, payload);
        return;
      }
      io.emit(event, payload);
    },
    revokeUserSession: (userId, reason) => {
      const room = `user:${userId}`;
      const socketIds = io.sockets.adapter.rooms.get(room);
      if (!socketIds || socketIds.size === 0) {
        return;
      }

      const targets = Array.from(socketIds)
        .map((sid) => io.sockets.sockets.get(sid))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));

      for (const s of targets) {
        s.data.revoked = true;
        s.emit('session:revoked', { reason });
      }

      if (targets.length > 0) {
        const timer = setTimeout(() => {
          for (const s of targets) {
            if (s.connected) {
              s.disconnect(true);
            }
          }
        }, 100);
        timer.unref();
      }
    },
  });

  return io;
}
