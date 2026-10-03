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

  async register(input: RegisterInput) {
    const session = await registerUser(this.authDeps(), input);
    return {
      user: session.user,
      accessToken: this.signAccessToken(session.user),
      refreshToken: session.refreshToken,
    };
  }

  async login(input: LoginInput) {
    const session = await loginUser(this.authDeps(), input);
    return {
      user: session.user,
      accessToken: this.signAccessToken(session.user),
      refreshToken: session.refreshToken,
    };
  }

  async refresh(input: RefreshTokenInput) {
    const session = await refreshSession(
      {
        userRepository: this.userRepository,
        refreshTokenRepository: this.refreshTokenRepository,
        refreshTokenExpiresIn: this.config.REFRESH_TOKEN_EXPIRES_IN,
      },
      input.refreshToken,
    );
    return {
      user: session.user,
      accessToken: this.signAccessToken(session.user),
      refreshToken: session.refreshToken,
    };
  }

  async logout(input: LogoutInput): Promise<void> {
    await logoutUser({ refreshTokenRepository: this.refreshTokenRepository }, input.refreshToken);
  }

  async createApiKey(userId: string, input: CreateApiKeyInput) {
    return createApiKey({ apiKeyRepository: this.apiKeyRepository }, userId, input);
  }

  async revokeApiKey(userId: string, apiKeyId: string): Promise<void> {
    await revokeApiKey({ apiKeyRepository: this.apiKeyRepository }, userId, apiKeyId);
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
    };
  }
}
