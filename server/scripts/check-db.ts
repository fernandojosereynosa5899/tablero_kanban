/**
 * Verificación rápida de la base de datos: usuarios (username/role/slot) y conteos.
 * Uso: npm run db:check
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { loadEnvFiles } from './lib/testCredentials';

loadEnvFiles();
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { slot: 'asc' },
    select: { username: true, role: true, slot: true, displayName: true, passwordHash: true },
  });

  console.log(`Usuarios (${users.length}):`);
  console.table(users.map(({ slot, username, role, displayName }) => ({ slot, username, role, displayName })));

  const leaders = users.filter((u) => u.role === 'LEADER').length;
  const subleaders = users.filter((u) => u.role === 'SUBLEADER').length;
  const members = users.filter((u) => u.role === 'MEMBER').length;
  console.log(`LEADER: ${leaders} | SUBLEADER: ${subleaders} | MEMBER: ${members}`);

  const [tasks, subtasks, comments, activity] = await Promise.all([
    prisma.task.count(),
    prisma.subtask.count(),
    prisma.comment.count(),
    prisma.activityLog.count(),
  ]);
  const byStatus = await prisma.task.groupBy({ by: ['status'], _count: { _all: true } });
  console.log(`Tareas: ${tasks} | Subtareas: ${subtasks} | Comentarios: ${comments} | Actividad: ${activity}`);
  console.log(
    'Tareas por columna:',
    byStatus.map((s) => `${s.status}=${s._count._all}`).join(', '),
  );

  const configuredSeed = (
    process.env.SEED_INITIAL_PASSWORD ??
    process.env.TEST_USER_PASSWORD ??
    ''
  ).trim();
  const lider = users.find((u) => u.username === 'lider');
  if (configuredSeed) {
    const liderOk = lider ? await bcrypt.compare(configuredSeed, lider.passwordHash) : false;
    console.log(`bcrypt.compare(credencial de entorno, hash de 'lider'): ${liderOk}`);
  } else {
    console.log('bcrypt.compare omitido (define SEED_INITIAL_PASSWORD en server/.env para verificarlo)');
  }

  const ok = users.length === 6 && leaders === 1 && subleaders === 1 && members === 4;
  console.log(
    ok
      ? 'OK: 6 usuarios (1 LEADER + 1 SUBLEADER + 4 MEMBER)'
      : 'ATENCIÓN: el número de usuarios/roles no es el esperado',
  );
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error('Error consultando la BD:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
