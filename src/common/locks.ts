import { Prisma } from '@prisma/client';
export async function lockEntities(tx: Prisma.TransactionClient, keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  }
}
