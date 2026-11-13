import type { NextFunction, Request, Response } from 'express';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SAFE_ENTITY_ID_RE = /^[a-zA-Z0-9_-]{4,40}$/;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;

  if (typeof value === 'string') {
    return value.replace(CONTROL_CHARS_RE, '');
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }
      const cleanVal = sanitizeValue(val, depth + 1);
      if (cleanVal !== undefined) {
        out[key] = cleanVal;
      }
    }
    return out;
  }

  return value;
}

export function sanitizeInputMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      if (DANGEROUS_KEYS.has(key)) {
        delete req.query[key];
      }
    }
  }
  next();
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

export function validateIdParam(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.params[paramName];
    if (typeof raw !== 'string' || !SAFE_ENTITY_ID_RE.test(raw)) {
      res.status(400).json({ error: 'Identificador de recurso inválido' });
      return;
    }
    next();
  };
}
