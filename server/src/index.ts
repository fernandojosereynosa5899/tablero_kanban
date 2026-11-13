import { createServer } from './app';
import { config } from './config';
import { prisma } from './prisma';

const { httpServer, io } = createServer();

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`[tablero-kanban-server] escuchando en http://0.0.0.0:${config.port} (entorno: ${config.nodeEnv})`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[tablero-kanban-server] señal ${signal} recibida, cerrando servidor...`);

  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
