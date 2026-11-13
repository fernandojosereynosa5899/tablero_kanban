import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config, isOriginAllowed } from './config';
import { apiNotFoundHandler, errorHandler } from './middleware/errorHandler';
import {
  apiMaintenanceGuard,
  sendMaintenanceHtmlResponse,
  serveMaintenanceClientScript,
  webMaintenanceGuard,
} from './middleware/maintenance';
import { globalApiLimiter, mutationApiLimiter } from './middleware/rateLimit';
import { sanitizeInputMiddleware, securityHeadersMiddleware } from './middleware/security';
import { attachmentsRouter } from './routes/attachments';
import { setupSocketIO } from './realtime/socket';
import { activityRouter } from './routes/activity';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { maintenanceRouter } from './routes/maintenance';
import { securityRouter } from './routes/security';
import { commentsRouter, subtasksRouter } from './routes/subtasks';
import { tasksRouter } from './routes/tasks';
import { usersRouter } from './routes/users';

function resolveClientDistDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../../client/dist'),
    path.resolve(process.cwd(), '../client/dist'),
    path.resolve(process.cwd(), 'client/dist'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return null;
}

export function createServer() {
  const app = express();
  const httpServer = http.createServer(app);

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https:', 'http://localhost:*', 'http://127.0.0.1:*'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(securityHeadersMiddleware);
  app.use(
    compression({
      filter: (req, res) => {
        // Evitar que Express recomprima binarios adjuntos y altere Content-Length en descargas
        if (req.path.endsWith('/download') || req.originalUrl.includes('/download')) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Origen no permitido por CORS'));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(sanitizeInputMiddleware);

  app.get('/maintenance-client.js', serveMaintenanceClientScript);

  app.use('/api', globalApiLimiter, mutationApiLimiter);
  app.use('/api/health', healthRouter);
  app.use('/api/maintenance', maintenanceRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', apiMaintenanceGuard);
  app.use('/api/users', usersRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/subtasks', subtasksRouter);
  app.use('/api/comments', commentsRouter);
  app.use('/api/attachments', attachmentsRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/security', securityRouter);

  app.use('/api', apiNotFoundHandler);

  app.use(webMaintenanceGuard);

  if (config.isProd) {
    const clientDistDir = resolveClientDistDir();
    if (clientDistDir) {
      const indexHtmlPath = path.join(clientDistDir, 'index.html');
      app.use(
        express.static(clientDistDir, {
          index: false,
          maxAge: '1d',
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-store');
            }
          },
        }),
      );

      app.get('*', (req, res, next) => {
        if (
          req.path.startsWith('/api') ||
          req.path.startsWith('/socket.io') ||
          req.path === '/maintenance-client.js'
        ) {
          next();
          return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(indexHtmlPath);
      });
    } else {
      console.warn('[tablero-kanban-server] Advertencia: no se encontró client/dist en modo producción.');
      app.get('*', (req, res, next) => {
        if (
          req.path.startsWith('/api') ||
          req.path.startsWith('/socket.io') ||
          req.path === '/maintenance-client.js'
        ) {
          next();
          return;
        }
        sendMaintenanceHtmlResponse(res, {
          active: true,
          source: 'file',
          canDisableInApp: false,
          title: 'Actualizando el Tablero Kanban',
          message:
            'Estamos terminando de compilar una actualización. Esta página se recargará automáticamente en unos segundos.',
          estimatedMinutes: 2,
          updatedByName: null,
          updatedAt: new Date().toISOString(),
        });
      });
    }
  }

  app.use(errorHandler);

  const io = setupSocketIO(httpServer);

  return { app, httpServer, io };
}
