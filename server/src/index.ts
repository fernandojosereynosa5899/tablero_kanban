import { createServer } from './app';
import { config } from './config';
import { prisma } from './prisma';
import { logger, redactSensitiveText } from './utils/logger';

const { httpServer, io } = createServer();

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  logger.error('server.listen_error', {
    port: config.port,
    code: err.code ?? null,
    errorName: err.name,
    message: redactSensitiveText(err.message),
  });
  process.exit(1);
});

httpServer.listen(config.port, '0.0.0.0', () => {
  logger.info('server.listening', {
    port: config.port,
    nodeEnv: config.nodeEnv,
  });
});

let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.shutdown_start', { signal, exitCode });

  let finalExitCode = exitCode;
  const forceExitTimer = setTimeout(() => {
    logger.error('server.shutdown_timeout', { signal });
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  try {
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });

    if (httpServer.listening) {
      httpServer.closeIdleConnections?.();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }

    try {
      await prisma.$disconnect();
    } catch (err) {
      finalExitCode = 1;
      logger.error('server.prisma_disconnect_error', {
        message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
      });
    }
  } catch (err) {
    finalExitCode = 1;
    logger.error('server.shutdown_error', {
      signal,
      message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
    });
  } finally {
    clearTimeout(forceExitTimer);
    logger.info('server.shutdown_complete', { signal, exitCode: finalExitCode });
    process.exit(finalExitCode);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM', 0);
});

process.on('SIGINT', () => {
  void shutdown('SIGINT', 0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled_rejection', {
    errorName: reason instanceof Error ? reason.name : 'UnhandledRejection',
    message: redactSensitiveText(reason instanceof Error ? reason.message : String(reason)),
  });
});

process.on('uncaughtException', (err) => {
  logger.error('process.uncaught_exception', {
    errorName: err.name,
    message: redactSensitiveText(err.message),
  });
  void shutdown('uncaughtException', 1);
});
