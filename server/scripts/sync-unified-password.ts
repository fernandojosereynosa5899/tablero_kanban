import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getSeedInitialPassword } from './lib/testCredentials';

const prisma = new PrismaClient();
const BCRYPT_COST = 10;

async function main() {
  const initialCredential = getSeedInitialPassword();
  console.log('[password-sync] Hasheando credencial inicial desde SEED_INITIAL_PASSWORD...');
  const passwordHash = await bcrypt.hash(initialCredential, BCRYPT_COST);

  const users = await prisma.user.findMany({
    select: { id: true, slot: true, username: true, displayName: true, role: true },
    orderBy: { slot: 'asc' },
  });

  console.log(`[password-sync] Encontrados ${users.length} usuarios en PostgreSQL:`);
  for (const u of users) {
    await prisma.user.update({
      where: { id: u.id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
    });
    console.log(`  ✓ Slot #${u.slot} | Usuario: "${u.username}" | Nombre: "${u.displayName}" -> Credencial sincronizada`);
  }

  // Verificación
  const verifyUsers = await prisma.user.findMany({
    select: { username: true, passwordHash: true },
  });
  for (const u of verifyUsers) {
    const ok = await bcrypt.compare(initialCredential, u.passwordHash);
    if (!ok) {
      throw new Error(`Fallo al verificar credencial para ${u.username}`);
    }
  }

  console.log(`[password-sync] ¡ÉXITO! Los ${verifyUsers.length} usuarios quedaron sincronizados con SEED_INITIAL_PASSWORD.`);
}

main()
  .catch((err) => {
    console.error('[password-sync] Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
