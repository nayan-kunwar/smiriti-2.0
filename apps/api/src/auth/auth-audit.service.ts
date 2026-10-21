import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { AuditLogEntry } from '@smriti/domain';
import { PrismaAuditLogRepository } from '@smriti/infrastructure';
import { PRISMA_CLIENT } from '../prisma/prisma.module.js';

/**
 * Authentication must not fail because the audit sink is unavailable. Audit
 * writes are best-effort and never include passwords, refresh tokens, or API
 * key material.
 */
@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);
  private readonly repository: PrismaAuditLogRepository;

  constructor(@Inject(PRISMA_CLIENT) prisma: PrismaClient) {
    this.repository = new PrismaAuditLogRepository(prisma);
  }

  async record(entry: AuditLogEntry): Promise<void> {
    try {
      await this.repository.append(entry);
    } catch (error) {
      this.logger.error(
        `Failed to write audit event ${entry.action} (correlationId=${entry.correlationId})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
