import type { Prisma, User } from '@prisma/client';
import { prisma } from '../prisma';

export type SecurityEventType =
  | 'devtools_opened'
  | 'inspect_shortcut'
  | 'context_menu_blocked'
  | 'storage_tamper'
  | 'dom_tamper'
  | 'unauthorized_action'
  | 'rate_limit_hit'
  | 'failed_login_lockout';

const EVENT_THROTTLE_MS = 10_000;
const recentEvents = new Map<string, number>();

export function isKuriUser(
  user: Pick<User, 'username' | 'displayName'> | { username?: string; displayName?: string } | null | undefined,
): boolean {
  if (!user) return false;
  const uname = (user.username ?? '').trim().toLowerCase();
  const dname = (user.displayName ?? '').trim().toLowerCase();
  return uname === 'integrante2' || dname.includes('kuri');
}

export function buildForbiddenMessage(
  actor: Pick<User, 'username' | 'displayName'> | null | undefined,
  fallbackMessage: string,
): string {
  if (isKuriUser(actor)) {
    return `Oye Kuri, por favor no muevas cosas que no te corresponden ni intentes modificar permisos (${fallbackMessage})`;
  }
  return fallbackMessage;
}

export function buildTamperWarningMessage(
  actor: Pick<User, 'username' | 'displayName'> | null | undefined,
): string {
  if (isKuriUser(actor)) {
    return 'Oye Kuri, no te metas al código ni muevas cosas extrañas. Todo cambio se valida y registra en el servidor.';
  }
  return 'Acción de inspección o modificación restringida. Las operaciones del tablero se validan en el servidor.';
}

export async function recordSecurityEvent(params: {
  userId?: string | null;
  username?: string;
  eventType: SecurityEventType;
  details?: Record<string, unknown>;
  ip?: string;
}): Promise<boolean> {
  const actorKey = params.userId ?? params.ip ?? 'anonymous';
  const throttleKey = `${actorKey}:${params.eventType}`;
  const now = Date.now();
  const prev = recentEvents.get(throttleKey);
  if (prev !== undefined && now - prev < EVENT_THROTTLE_MS) {
    return false;
  }
  recentEvents.set(throttleKey, now);

  // Evita crecimiento ilimitado en memoria
  if (recentEvents.size > 500) {
    for (const [key, ts] of recentEvents.entries()) {
      if (now - ts > EVENT_THROTTLE_MS * 6) {
        recentEvents.delete(key);
      }
    }
  }

  const sanitizedDetails: Record<string, unknown> = {
    eventType: params.eventType,
    ...(params.username ? { username: params.username } : {}),
    ...(params.ip ? { ip: params.ip.slice(0, 64) } : {}),
    ...(params.details ?? {}),
  };

  console.warn('[SECURITY]', JSON.stringify(sanitizedDetails));

  if (!params.userId) {
    return true;
  }

  try {
    await prisma.activityLog.create({
      data: {
        userId: params.userId,
        action: 'security.alert',
        details: sanitizedDetails as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error('[SECURITY] No se pudo guardar evento en ActivityLog:', err);
  }
  return true;
}
