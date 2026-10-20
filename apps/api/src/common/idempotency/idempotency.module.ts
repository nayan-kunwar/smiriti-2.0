import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaIdempotencyStore } from '@smriti/infrastructure';
import { PRISMA_CLIENT } from '../../prisma/prisma.module.js';
import { IDEMPOTENCY_STORE } from './idempotency.constants.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyService } from './idempotency.service.js';

@Module({
  providers: [
    IdempotencyService,
    IdempotencyInterceptor,
    {
      provide: IDEMPOTENCY_STORE,
      useFactory: (prisma: PrismaClient) => new PrismaIdempotencyStore(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
