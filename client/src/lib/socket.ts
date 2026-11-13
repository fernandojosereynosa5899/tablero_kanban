import { io, type Socket } from 'socket.io-client';
import type {
  Activity,
  Comment,
  MaintenanceStatus,
  Task,
  TaskStatus,
  UserPublic,
} from '../types/kanban';

export interface PresencePayload {
  onlineUserIds: string[];
}

export interface SessionRevokedPayload {
  reason: string;
}

export interface TaskMovedPayload {
  task: Task;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  by: UserPublic;
}

export interface TaskApprovedPayload {
  task: Task;
  by: UserPublic;
}

export interface CommentCreatedPayload {
  taskId: string;
  comment: Comment;
}

export interface CommentDeletedPayload {
  taskId: string;
  id: string;
}

export interface AttachmentCreatedPayload {
  taskId: string;
  attachment: import('../types/kanban').TaskAttachment;
}

export interface AttachmentDeletedPayload {
  taskId: string;
  id: string;
}

export interface CommentTypingPayload {
  taskId: string;
  userId: string;
  displayName: string;
  isTyping: boolean;
}

export interface ServerToClientEvents {
  'presence:update': (payload: PresencePayload) => void;
  'session:revoked': (payload: SessionRevokedPayload) => void;
  'user:created': (user: UserPublic) => void;
  'user:updated': (user: UserPublic) => void;
  'user:deleted': (payload: { id: string }) => void;
  'task:created': (task: Task) => void;
  'task:updated': (task: Task) => void;
  'task:deleted': (payload: { id: string }) => void;
  'task:moved': (payload: TaskMovedPayload) => void;
  'task:approved': (payload: TaskApprovedPayload) => void;
  'comment:created': (payload: CommentCreatedPayload) => void;
  'comment:deleted': (payload: CommentDeletedPayload) => void;
  'comment:typing': (payload: CommentTypingPayload) => void;
  'attachment:created': (payload: AttachmentCreatedPayload) => void;
  'attachment:deleted': (payload: AttachmentDeletedPayload) => void;
  'activity:new': (activity: Activity) => void;
  'maintenance:updated': (status: MaintenanceStatus) => void;
}

export interface TaskMoveEmitPayload {
  taskId: string;
  status: TaskStatus;
  position?: number;
}

export type TaskMoveAckResponse = { ok: true; task: Task } | { ok: false; error: string };

export interface ClientToServerEvents {
  'task:move': (
    payload: TaskMoveEmitPayload,
    ack: (response: TaskMoveAckResponse) => void,
  ) => void;
  'comment:typing': (payload: { taskId: string; isTyping: boolean }) => void;
}

export type KanbanSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface SocketHandlers {
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onConnectError?: (error: Error) => void;
  onPresenceUpdate?: (onlineUserIds: string[]) => void;
  onSessionRevoked?: (reason: string) => void;
  onMaintenanceReject?: () => void;
}

export function createKanbanSocket(token: string, handlers: SocketHandlers = {}): KanbanSocket {
  const socket: KanbanSocket = io(window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: false,
  });

  socket.on('connect', () => {
    handlers.onConnect?.();
  });

  socket.on('disconnect', (reason) => {
    handlers.onDisconnect?.(reason);
  });

  socket.on('connect_error', (err) => {
    if (err?.message === 'maintenance') {
      handlers.onMaintenanceReject?.();
    }
    handlers.onConnectError?.(err);
  });

  socket.on('presence:update', (payload) => {
    if (Array.isArray(payload?.onlineUserIds)) {
      handlers.onPresenceUpdate?.(payload.onlineUserIds);
    }
  });

  socket.on('session:revoked', (payload) => {
    handlers.onSessionRevoked?.(payload?.reason || 'Tu sesión ha sido cerrada');
  });

  return socket;
}
