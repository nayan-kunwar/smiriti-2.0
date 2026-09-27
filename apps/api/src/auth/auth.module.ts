import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule, APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '@smriti/shared';
import { AuthController, ApiKeysController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { AppThrottlerGuard } from './guards/app-throttler.guard.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

@Module({
  imports: [
    AppConfigModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_SECRET,
        signOptions: { expiresIn: config.JWT_EXPIRES_IN as `${number}${'s' | 'm' | 'h' | 'd'}` },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            ttl: config.RATE_LIMIT_TTL * 1000,
            limit: config.RATE_LIMIT_MAX,
          },
        ],
        storage: new RedisThrottlerStorage(config.REDIS_URL),
      }),
    }),
  ],
  controllers: [AuthController, ApiKeysController],
  providers: [
    AuthService,
    AuthGuard,
    RolesGuard,
    AppThrottlerGuard,
    { provide: APP_GUARD, useExisting: AppThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
