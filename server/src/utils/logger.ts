import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { getClientIp } from '../middleware/rateLimit';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export type LogLevel = 'info' | 'warn' | 'error';

export type LogSink = (level: LogLevel, line: string, entry: Record<string, unknown>) => void;

const SAFE_REQUEST_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

const SENSITIVE_KEY_RE =
  /^(authorization|cookie|set-cookie|password|currentpassword|newpassword|token|accesstoken|access_token|refreshtoken|refresh_token|clientsecret|client_secret|jwtsecret|jwt_secret|database_url|smtppass|smtp_pass|body|reqbody)$/i;

let customLogSink: LogSink | null = null;

export function setLoggerSinkForTests(sink: LogSink | null): void {
  customLogSink = sink;
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:access_token|refresh_token|token|client_secret|password|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:access_token|refresh_token|client_secret|password|authorization|cookie)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, '[REDACTED_JWT]');
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeLogValue(val, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function sanitizeLogMeta(meta?: Record<string, unknown>): Record<string, unknown> {
  if (!meta) return {};
  return sanitizeLogValue(meta, 0) as Record<string, unknown>;
}

function writeLog(level: LogLevel, event: string, meta?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    level,
    event,
    time: new Date().toISOString(),
    ...sanitizeLogMeta(meta),
  };
  const line = JSON.stringify(entry);

  if (customLogSink) {
    customLogSink(level, line, entry);
    return;
  }

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(event: string, meta?: Record<string, unknown>): void {
    writeLog('info', event, meta);
  },
  warn(event: string, meta?: Record<string, unknown>): void {
    writeLog('warn', event, meta);
  },
  error(event: string, meta?: Record<string, unknown>): void {
    writeLog('error', event, meta);
  },
};

export function extractSafePath(req: Pick<Request, 'originalUrl' | 'url'>): string {
  const raw = req.originalUrl || req.url || '/';
  const qIndex = raw.indexOf('?');
  return qIndex === -1 ? raw : raw.slice(0, qIndex);
}

export function createRequestLoggerMiddleware(options?: { isProd?: boolean }) {
  const prodMode = options?.isProd ?? config.isProd;

  return (req: Request, res: Response, next: NextFunction): void => {
    const incomingId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].trim() : '';
    const requestId = SAFE_REQUEST_ID_RE.test(incomingId) ? incomingId : crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const startedAtNs = process.hrtime.bigint();

    res.on('finish', () => {
      const pathOnly = extractSafePath(req);
      if (prodMode && res.statusCode === 200 && (pathOnly === '/api/health' || pathOnly === '/health')) {
        return;
      }

      const durationMs = Number((Number(process.hrtime.bigint() - startedAtNs) / 1_000_000).toFixed(2));
      const level: LogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      writeLog(level, 'http.request', {
        requestId,
        method: req.method,
        path: pathOnly,
        statusCode: res.statusCode,
        durationMs,
        ip: getClientIp(req),
        userId: req.user?.id ?? null,
      });
    });

    next();
  };
}

export const requestLoggerMiddleware = createRequestLoggerMiddleware();
