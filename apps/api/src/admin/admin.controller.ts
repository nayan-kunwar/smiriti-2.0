import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { listAuditLogs, listUsers } from '@smriti/application';
import { ListAdminQuerySchema, type ListAdminQueryInput } from '@smriti/shared';
import { PrismaAuditLogRepository, PrismaUserRepository } from '@smriti/infrastructure';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PRISMA_CLIENT } from '../prisma/prisma.module.js';

@Controller('v1/admin')
@Roles('admin')
export class AdminController {
  private readonly userRepository: PrismaUserRepository;
  private readonly auditLogRepository: PrismaAuditLogRepository;

  constructor(@Inject(PRISMA_CLIENT) prisma: PrismaClient) {
    this.userRepository = new PrismaUserRepository(prisma);
    this.auditLogRepository = new PrismaAuditLogRepository(prisma);
  }

  @Get('users')
  async listUsers(@Query(new ZodValidationPipe(ListAdminQuerySchema)) query: ListAdminQueryInput) {
    return listUsers({ userRepository: this.userRepository }, query);
  }

  @Get('audit-logs')
  async listAuditLogs(
    @Query(new ZodValidationPipe(ListAdminQuerySchema)) query: ListAdminQueryInput,
  ) {
    return listAuditLogs({ auditLogRepository: this.auditLogRepository }, query);
  }
}
