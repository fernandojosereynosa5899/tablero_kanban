import type { TaskStatus } from '@prisma/client';
import type { Activity, Comment, Task, TaskAttachment, UserPublic } from '../types/domain';

export type UserRealtimeEventName = 'user:created' | 'user:updated' | 'user:deleted';

export type UserRealtimePayloadMap = {
  'user:created': UserPublic;
  'user:updated': UserPublic;
  'user:deleted': { id: string };
};

export type RealtimePayloadMap = UserRealtimePayloadMap & {
  'task:created': Task;
  'task:updated': Task;
  'task:deleted': { id: string };
  'task:moved': { task: Task; fromStatus: TaskStatus; toStatus: TaskStatus; by: UserPublic };
  'task:approved': { task: Task; by: UserPublic };
  'comment:created': { taskId: string; comment: Comment };
  'comment:deleted': { taskId: string; id: string };
  'attachment:created': { taskId: string; attachment: TaskAttachment };
  'attachment:deleted': { taskId: string; id: string };
  'activity:new': Activity;
};

export type RealtimeEventName = keyof RealtimePayloadMap;

export interface RealtimeHooks {
  emitEvent: <E extends RealtimeEventName>(event: E, payload: RealtimePayloadMap[E]) => void;
  emitUserEvent: <E extends UserRealtimeEventName>(event: E, payload: UserRealtimePayloadMap[E]) => void;
  revokeUserSession: (userId: string, reason: string) => void;
}

const noopHooks: RealtimeHooks = {
  emitEvent: () => {},
  emitUserEvent: () => {},
  revokeUserSession: () => {},
};

let activeHooks: RealtimeHooks = { ...noopHooks };

/** Enlaza los emisores reales de Socket.IO en tiempo de ejecución. */
export function registerRealtimeHooks(hooks: Partial<RealtimeHooks>): void {
  const nextEmitEvent = hooks.emitEvent ?? activeHooks.emitEvent;
  activeHooks = {
    emitEvent: nextEmitEvent,
    emitUserEvent:
      hooks.emitUserEvent ??
      (<E extends UserRealtimeEventName>(event: E, payload: UserRealtimePayloadMap[E]) => {
        nextEmitEvent(event, payload as RealtimePayloadMap[E]);
      }),
    revokeUserSession: hooks.revokeUserSession ?? activeHooks.revokeUserSession,
  };
}

export function resetRealtimeHooks(): void {
  activeHooks = { ...noopHooks };
}

export const realtimeHooks: RealtimeHooks = {
  emitEvent(event, payload) {
    activeHooks.emitEvent(event, payload);
  },
  emitUserEvent(event, payload) {
    activeHooks.emitUserEvent(event, payload);
  },
  revokeUserSession(userId, reason) {
    activeHooks.revokeUserSession(userId, reason);
  },
};

export function emitEvent<E extends RealtimeEventName>(event: E, payload: RealtimePayloadMap[E]): void {
  realtimeHooks.emitEvent(event, payload);
}

export function emitUserEvent<E extends UserRealtimeEventName>(
  event: E,
  payload: UserRealtimePayloadMap[E],
): void {
  realtimeHooks.emitUserEvent(event, payload);
}

export function revokeUserSession(userId: string, reason: string): void {
  realtimeHooks.revokeUserSession(userId, reason);
}
