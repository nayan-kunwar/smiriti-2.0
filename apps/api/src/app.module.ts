import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { MemoryModule } from './memory/memory.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req) =>
          (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID(),
        customProps: (req) => ({
          correlationId: req.id,
        }),
        serializers: {
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    AdminModule,
    MemoryModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
