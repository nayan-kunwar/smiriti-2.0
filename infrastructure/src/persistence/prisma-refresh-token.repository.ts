import type { RefreshTokenRecord, RefreshTokenRepository } from '@smriti/domain';
import type { PrismaClient } from '@prisma/client';

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(record: RefreshTokenRecord): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        id: record.id,
        userId: record.userId,
        tokenHash: record.tokenHash,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
      },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const record = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
    });
    if (!record) return null;
    return {
      id: record.id,
      userId: record.userId,
      tokenHash: record.tokenHash,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
    };
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
}
