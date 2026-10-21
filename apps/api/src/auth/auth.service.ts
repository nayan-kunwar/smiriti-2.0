import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PrismaClient } from '@prisma/client';
import {
  createApiKey,
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
  revokeApiKey,
  validateApiKeyUser,
  type AuthSession,
} from '@smriti/application';
import { hashToken } from '@smriti/domain';
import { UnauthorizedError } from '@smriti/shared';
import type { AppConfig } from '@smriti/shared';
import type {
  CreateApiKeyInput,
  LoginInput,
  LogoutInput,
  RefreshTokenInput,
  RegisterInput,
} from '@smriti/shared';
import {
  BcryptPasswordHasher,
  PrismaApiKeyRepository,
  PrismaRefreshTokenRepository,
  PrismaUserRepository,
} from '@smriti/infrastructure';
import { APP_CONFIG } from '../config/config.module.js';
import { PRISMA_CLIENT } from '../prisma/prisma.module.js';
import type { AuthenticatedUser } from '../common/decorators/request-context.decorator.js';
import { AuthAuditService } from './auth-audit.service.js';

@Injectable()
export class AuthService {
  private readonly userRepository: PrismaUserRepository;
  private readonly refreshTokenRepository: PrismaRefreshTokenRepository;
  private readonly apiKeyRepository: PrismaApiKeyRepository;
  private readonly passwordHasher = new BcryptPasswordHasher();

  constructor(
    @Inject(PRISMA_CLIENT) prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(AuthAuditService) private readonly authAudit: AuthAuditService,
  ) {
    this.userRepository = new PrismaUserRepository(prisma);
    this.refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);
    this.apiKeyRepository = new PrismaApiKeyRepository(prisma);
  }

  private authDeps() {
    return {
      userRepository: this.userRepository,
      refreshTokenRepository: this.refreshTokenRepository,
      passwordHasher: this.passwordHasher,
      refreshTokenExpiresIn: this.config.REFRESH_TOKEN_EXPIRES_IN,
    };
  }

  private signAccessToken(user: { id: string; role: 'user' | 'admin' }): string {
    return this.jwtService.sign({
      sub: user.id,
      role: user.role,
    });
  }

  private recordAuthEvent(
    action: string,
    userId: string,
    payloadSnapshot: Record<string, unknown>,
    correlationId: string,
  ): Promise<void> {
    return this.authAudit.record({
      userId,
      action,
      entityType: 'user',
      entityId: userId,
      payloadSnapshot,
      correlationId,
    });
  }

  async register(input: RegisterInput, correlationId: string) {
    const session = await registerUser(this.authDeps(), input);
    await this.recordAuthEvent(
      'auth.register',
      session.user.id,
      { email: session.user.email },
      correlationId,
    );
    return {
      user: session.user,
      accessToken: this.signAccessToken(session.user),
      refreshToken: session.refreshToken,
    };
  }

  async login(input: LoginInput, correlationId: string) {
    let session: AuthSession;
    try {
      session = await loginUser(this.authDeps(), input);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        const user = await this.userRepository.findByEmail(input.email).catch(() => null);
        if (user) {
          await this.recordAuthEvent(
            'auth.login_failed',
            user.id,
            { email: user.email, reason: 'invalid_credentials' },
            correlationId,
          );
        }
      }
      throw error;
    }

    await this.recordAuthEvent(
      'auth.login',
      session.user.id,
      { email: session.user.email },
      correlationId,
    );
    return {
      user: session.user,
      accessToken: this.signAccessToken(session.user),
      refreshToken: session.refreshToken,
    };
  }

  async refresh(input: RefreshTokenInput, correlationId: string) {
    const session = await refreshSession(
      {
        userRepository: this.userRepository,
        refreshTokenRepository: this.refreshTokenRepository,
        refreshTokenExpiresIn: this.config.REFRESH_TOKEN_EXPIRES_IN,
      },
      input.refreshToken,
    );
    await this.recordAuthEvent('auth.refresh', session.user.id, {}, correlationId);
    return {
      user: session.user,
      accessToken: this.signAccessToken(session.user),
      refreshToken: session.refreshToken,
    };
  }

  async logout(input: LogoutInput, correlationId: string): Promise<void> {
    const userId = await logoutUser(
      { refreshTokenRepository: this.refreshTokenRepository },
      input.refreshToken,
    );
    if (userId) {
      await this.recordAuthEvent('auth.logout', userId, {}, correlationId);
    }
  }

  async createApiKey(userId: string, input: CreateApiKeyInput, correlationId: string) {
    const apiKey = await createApiKey({ apiKeyRepository: this.apiKeyRepository }, userId, input);
    await this.authAudit.record({
      userId,
      action: 'api_key.create',
      entityType: 'api_key',
      entityId: apiKey.id,
      payloadSnapshot: { name: apiKey.name, scopes: apiKey.scopes },
      correlationId,
    });
    return apiKey;
  }

  async revokeApiKey(userId: string, apiKeyId: string, correlationId: string): Promise<void> {
    await revokeApiKey({ apiKeyRepository: this.apiKeyRepository }, userId, apiKeyId);
    await this.authAudit.record({
      userId,
      action: 'api_key.revoke',
      entityType: 'api_key',
      entityId: apiKeyId,
      payloadSnapshot: {},
      correlationId,
    });
  }

  async authenticateApiKey(apiKey: string): Promise<AuthenticatedUser> {
    if (!apiKey.startsWith('smriti_')) {
      throw new UnauthorizedError('Invalid API key');
    }

    const record = await this.apiKeyRepository.findByKeyHash(hashToken(apiKey));
    if (!record) {
      throw new UnauthorizedError('Invalid API key');
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      throw new UnauthorizedError('API key expired');
    }

    const user = await validateApiKeyUser({ userRepository: this.userRepository }, record.userId);
    await this.apiKeyRepository.updateLastUsed(record.id);

    return {
      userId: user.id,
      role: user.role,
      authMethod: 'api_key',
      apiKeyId: record.id,
    };
  }
}
