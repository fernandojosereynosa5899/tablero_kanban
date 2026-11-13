import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { verifyJwtAndLoadUser } from '../services/authService';
import { buildForbiddenMessage, recordSecurityEvent } from '../services/securityService';
import { getClientIp } from './rateLimit';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user: User;
}

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1]?.trim() || null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  try {
    const user = await verifyJwtAndLoadUser(token);
    req.user = user;
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No autorizado';
    res.status(401).json({ error: message });
  }
}

export function requireLeader(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  if (req.user.role !== 'LEADER') {
    void recordSecurityEvent({
      userId: req.user.id,
      username: req.user.username,
      eventType: 'unauthorized_action',
      details: { method: req.method, path: req.originalUrl, reason: 'requireLeader' },
      ip: getClientIp(req),
    });
    res.status(403).json({
      error: buildForbiddenMessage(req.user, 'Solo el líder puede realizar esta acción'),
    });
    return;
  }
  next();
}

export function requireTaskCreator(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  if (req.user.role !== 'LEADER' && req.user.role !== 'SUBLEADER') {
    void recordSecurityEvent({
      userId: req.user.id,
      username: req.user.username,
      eventType: 'unauthorized_action',
      details: { method: req.method, path: req.originalUrl, reason: 'requireTaskCreator' },
      ip: getClientIp(req),
    });
    res.status(403).json({
      error: buildForbiddenMessage(req.user, 'Solo el líder o sublíder pueden agregar tareas'),
    });
    return;
  }
  next();
}
