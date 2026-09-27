import { Controller, Get, Inject } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../prisma/prisma.module.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '@smriti/shared';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller()
@Public()
export class HealthController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('live')
  live() {
    return { status: 'alive' };
  }

  @Get('ready')
  async ready() {
    const checks: Record<string, string> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'error';
    }

    // Redis TCP check deferred to Slice 3 (BullMQ); mark as not_checked until worker integration
    checks.redis = 'not_checked';

    try {
      const response = await fetch(`${this.config.QDRANT_URL}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      checks.qdrant = response.ok ? 'ok' : 'error';
    } catch {
      checks.qdrant = 'degraded';
    }

    const isReady = checks.postgres === 'ok';
    return {
      status: isReady ? 'ready' : 'not_ready',
      checks,
    };
  }
}
