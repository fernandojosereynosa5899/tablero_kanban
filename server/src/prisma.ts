import { PrismaClient } from '@prisma/client';

// Singleton de PrismaClient (evita múltiples conexiones en recargas con tsx watch)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
    transactionOptions: {
      maxWait: 15_000,
      timeout: 30_000,
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
