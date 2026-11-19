import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../utils/errors';
import { extractSafePath, logger, redactSensitiveText } from '../utils/logger';
import { formatZodError } from '../utils/validation';
import { getClientIp } from './rateLimit';

export function apiNotFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Ruta de API no encontrada' });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    if (err.statusCode === 403 && err.message.includes('CORS')) {
      logger.warn('http.cors_rejected', {
        requestId: req.requestId ?? null,
        method: req.method,
        path: extractSafePath(req),
        ip: getClientIp(req),
        statusCode: 403,
        message: err.message,
      });
    }
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: formatZodError(err) });
    return;
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    (('type' in err && (err as { type?: unknown }).type === 'entity.too.large') ||
      ('status' in err && (err as { status?: unknown }).status === 413) ||
      ('statusCode' in err && (err as { statusCode?: unknown }).statusCode === 413))
  ) {
    res.status(413).json({ error: 'El cuerpo de la solicitud supera el límite máximo permitido' });
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Cuerpo JSON inválido' });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'El archivo supera el límite máximo de 5 MB' });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: 'Envía un único archivo usando el campo "file"' });
      return;
    }
    res.status(400).json({ error: `Error al recibir archivo: ${err.message}` });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target ?? '');
      if (target.includes('slot')) {
        res.status(409).json({ error: 'Límite máximo de 6 usuarios alcanzado' });
        return;
      }
      res.status(409).json({ error: 'Ya existe un registro con ese valor único' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    }
  }

  logger.error('http.unhandled_error', {
    requestId: req.requestId ?? null,
    method: req.method,
    path: extractSafePath(req),
    ip: getClientIp(req),
    userId: req.user?.id ?? null,
    errorName: err instanceof Error ? err.name : 'UnknownError',
    message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
  });
  res.status(500).json({ error: 'Error interno del servidor' });
}
