import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

export * from './persistence/prisma-memory.repository.js';
export * from './persistence/prisma-memory-embedding.store.js';
export * from './persistence/prisma-audit-log.repository.js';
export * from './persistence/prisma-user.repository.js';
export * from './persistence/prisma-refresh-token.repository.js';
export * from './persistence/prisma-api-key.repository.js';
export * from './crypto/bcrypt-password-hasher.js';
export * from './embeddings/openai-compatible-embedding.provider.js';
export * from './embeddings/factory.js';
export * from './vector/qdrant-vector.store.js';
export * from './queue/bullmq-job.queue.js';
export * from './testing/in-memory-repositories.js';
export * from './testing/fake-embedding-provider.js';
export * from './testing/fake-vector-store.js';
export * from './testing/fake-job-queue.js';
export * from './testing/fake-embedding-store.js';
