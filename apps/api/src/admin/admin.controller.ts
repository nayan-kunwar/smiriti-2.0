import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { listAuditLogs, listJobFailures, listUsers, retryJobFailure } from '@smriti/application';
import type { JobQueue } from '@smriti/domain';
import {
  ListAdminQuerySchema,
  ListJobFailuresQuerySchema,
  type ListAdminQueryInput,
  type ListJobFailuresQueryInput,
} from '@smriti/shared';
import {
  PrismaAuditLogRepository,
  PrismaJobFailureRepository,
  PrismaUserRepository,
  type Metrics,
} from '@smriti/infrastructure';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CorrelationId, CurrentUserId } from '../common/decorators/request-context.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PRISMA_CLIENT } from '../prisma/prisma.module.js';
import { JOB_QUEUE } from '../memory/memory.tokens.js';
import { METRICS } from '../metrics/metrics.constants.js';

@Controller('v1/admin')
@Roles('admin')
export class AdminController {
  private readonly userRepository: PrismaUserRepository;
  private readonly auditLogRepository: PrismaAuditLogRepository;
  private readonly jobFailureRepository: PrismaJobFailureRepository;

  constructor(
    @Inject(PRISMA_CLIENT) prisma: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueue,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {
    this.userRepository = new PrismaUserRepository(prisma);
    this.auditLogRepository = new PrismaAuditLogRepository(prisma);
    this.jobFailureRepository = new PrismaJobFailureRepository(prisma);
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

  @Get('job-failures')
  async getJobFailures(
    @Query(new ZodValidationPipe(ListJobFailuresQuerySchema)) query: ListJobFailuresQueryInput,
  ) {
    return listJobFailures({ jobFailureRepository: this.jobFailureRepository }, query);
  }

  @Post('job-failures/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retry(
    @CurrentUserId() userId: string,
    @CorrelationId() correlationId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const failure = await retryJobFailure(
      {
        jobFailureRepository: this.jobFailureRepository,
        auditLogRepository: this.auditLogRepository,
        jobQueue: this.jobQueue,
      },
      { failureId: id, userId, correlationId },
    );
    this.metrics.observeManualJobRetry(failure.queue, failure.jobName);
    return failure;
  }
}
