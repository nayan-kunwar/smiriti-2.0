import type { ApiKeyRecord, ApiKeyRepository } from '@smriti/domain';
import type { PrismaClient } from '@prisma/client';

export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(record: ApiKeyRecord): Promise<void> {
    await this.prisma.apiKey.create({
      data: {
        id: record.id,
        userId: record.userId,
        keyHash: record.keyHash,
        name: record.name,
        scopes: record.scopes,
        lastUsedAt: record.lastUsedAt,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
    });
  }

  async findByKeyHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const record = await this.prisma.apiKey.findFirst({ where: { keyHash } });
    if (!record) return null;
    return {
      id: record.id,
      userId: record.userId,
      keyHash: record.keyHash,
      name: record.name,
      scopes: record.scopes,
      lastUsedAt: record.lastUsedAt,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    };
  }

  async findById(userId: string, id: string): Promise<ApiKeyRecord | null> {
    const record = await this.prisma.apiKey.findFirst({ where: { id, userId } });
    if (!record) return null;
    return {
      id: record.id,
      userId: record.userId,
      keyHash: record.keyHash,
      name: record.name,
      scopes: record.scopes,
      lastUsedAt: record.lastUsedAt,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    };
  }

  async findByUser(userId: string): Promise<ApiKeyRecord[]> {
    const records = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => ({
      id: record.id,
      userId: record.userId,
      keyHash: record.keyHash,
      name: record.name,
      scopes: record.scopes,
      lastUsedAt: record.lastUsedAt,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    }));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.apiKey.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
