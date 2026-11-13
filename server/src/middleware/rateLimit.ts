import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message: string;
  keyPrefix: string;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

const stores = new Map<string, Map<string, Bucket>>();

function getStore(prefix: string): Map<string, Bucket> {
  let store = stores.get(prefix);
  if (!store) {
    store = new Map();
    stores.set(prefix, store);
  }
  return store;
}

function cleanupExpired(store: Map<string, Bucket>, now: number): void {
  if (store.size < 400) return;
  for (const [key, bucket] of store.entries()) {
    if (now >= bucket.resetAt) {
      store.delete(key);
    }
  }
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimiter(options: RateLimitOptions) {
  const store = getStore(options.keyPrefix);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (options.skip?.(req)) {
      next();
      return;
    }

    const now = Date.now();
    cleanupExpired(store, now);

    const key = options.keyGenerator ? options.keyGenerator(req) : getClientIp(req);
    const existing = store.get(key);

    if (!existing || now >= existing.resetAt) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: options.message });
      return;
    }

    next();
  };
}

export const globalApiLimiter = createRateLimiter({
  keyPrefix: 'global-api',
  windowMs: 60_000,
  max: 600,
  message: 'Demasiadas solicitudes seguidas. Intenta de nuevo en unos segundos.',
  skip: (req) => req.path === '/health' || req.path === '/api/health',
});

export const mutationApiLimiter = createRateLimiter({
  keyPrefix: 'mutation-api',
  windowMs: 60_000,
  max: 240,
  message: 'Límite de modificaciones por minuto alcanzado. Espera un momento.',
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});

export const loginIpLimiter = createRateLimiter({
  keyPrefix: 'login-ip',
  windowMs: 5 * 60_000,
  max: 25,
  message: 'Demasiados intentos de inicio de sesión desde esta red. Espera 5 minutos.',
});

export const securityReportLimiter = createRateLimiter({
  keyPrefix: 'security-report',
  windowMs: 60_000,
  max: 15,
  message: 'Límite de reportes de seguridad alcanzado.',
  keyGenerator: (req) => req.user?.id ?? getClientIp(req),
});

export const uploadApiLimiter = createRateLimiter({
  keyPrefix: 'attachment-upload',
  windowMs: 60_000,
  max: 20,
  message: 'Límite de subida de archivos por minuto alcanzado. Espera un momento.',
  keyGenerator: (req) => req.user?.id ?? getClientIp(req),
});

// Bloqueo por fallos repetidos de contraseña por IP + usuario
const FAILED_LOGIN_WINDOW_MS = 5 * 60_000;
const FAILED_LOGIN_MAX = 6;
const failedLoginStore = getStore('failed-login');

export function isLoginLocked(ip: string, normalizedUsername: string): { locked: boolean; retryAfterSec: number } {
  const key = `${ip}:${normalizedUsername}`;
  const now = Date.now();
  const bucket = failedLoginStore.get(key);
  if (!bucket || now >= bucket.resetAt) {
    failedLoginStore.delete(key);
    return { locked: false, retryAfterSec: 0 };
  }
  if (bucket.count >= FAILED_LOGIN_MAX) {
    return {
      locked: true,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { locked: false, retryAfterSec: 0 };
}

export function recordFailedLoginAttempt(ip: string, normalizedUsername: string): void {
  const key = `${ip}:${normalizedUsername}`;
  const now = Date.now();
  cleanupExpired(failedLoginStore, now);
  const bucket = failedLoginStore.get(key);
  if (!bucket || now >= bucket.resetAt) {
    failedLoginStore.set(key, { count: 1, resetAt: now + FAILED_LOGIN_WINDOW_MS });
  } else {
    bucket.count += 1;
  }
}

export function clearFailedLoginAttempts(ip: string, normalizedUsername: string): void {
  failedLoginStore.delete(`${ip}:${normalizedUsername}`);
}

const SOCKET_MOVE_WINDOW_MS = 10_000;
const SOCKET_MOVE_MAX = 25;
const socketStore = getStore('socket-move');

export function allowSocketMoveEvent(socketId: string): boolean {
  const now = Date.now();
  cleanupExpired(socketStore, now);
  const bucket = socketStore.get(socketId);
  if (!bucket || now >= bucket.resetAt) {
    socketStore.set(socketId, { count: 1, resetAt: now + SOCKET_MOVE_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= SOCKET_MOVE_MAX;
}

const SOCKET_TYPING_WINDOW_MS = 10_000;
const SOCKET_TYPING_MAX = 25;
const socketTypingStore = getStore('socket-typing');

export function allowSocketTypingEvent(socketId: string): boolean {
  const now = Date.now();
  cleanupExpired(socketTypingStore, now);
  const bucket = socketTypingStore.get(socketId);
  if (!bucket || now >= bucket.resetAt) {
    socketTypingStore.set(socketId, { count: 1, resetAt: now + SOCKET_TYPING_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= SOCKET_TYPING_MAX;
}
