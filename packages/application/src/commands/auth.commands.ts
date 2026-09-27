import { randomBytes, randomUUID } from 'node:crypto';
import { User, hashToken, type ApiKeyRepository, type PasswordHasher, type RefreshTokenRepository, type UserRepository } from '@smriti/domain';
import { NotFoundError, ConflictError, UnauthorizedError } from '@smriti/shared';
import type { CreateApiKeyInput, LoginInput, RegisterInput } from '@smriti/shared';
import { toUserDto, type UserDto } from '../mappers/user.mapper.js';
import { parseDurationToMs } from '../utils/duration.js';

export interface AuthSession {
  user: UserDto;
  refreshToken: string;
}

export interface RegisterDeps {
  userRepository: UserRepository;
  refreshTokenRepository: RefreshTokenRepository;
  passwordHasher: PasswordHasher;
  refreshTokenExpiresIn: string;
}

export type LoginDeps = RegisterDeps;

export interface RefreshDeps {
  userRepository: UserRepository;
  refreshTokenRepository: RefreshTokenRepository;
  refreshTokenExpiresIn: string;
}

export interface LogoutDeps {
  refreshTokenRepository: RefreshTokenRepository;
}

export interface CreateApiKeyDeps {
  apiKeyRepository: ApiKeyRepository;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  key?: string;
}

function createRefreshTokenRecord(userId: string, refreshTokenExpiresIn: string) {
  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + parseDurationToMs(refreshTokenExpiresIn));

  return {
    refreshToken,
    record: {
      id: randomUUID(),
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      revokedAt: null,
    },
  };
}

export async function registerUser(
  deps: RegisterDeps,
  input: RegisterInput,
): Promise<AuthSession> {
  const existing = await deps.userRepository.findByEmail(input.email);
  if (existing) {
    throw new ConflictError('Email already registered');
  }

  const passwordHash = await deps.passwordHasher.hash(input.password);
  const user = User.create({ email: input.email, passwordHash });
  await deps.userRepository.save(user);

  const { refreshToken, record } = createRefreshTokenRecord(
    user.id,
    deps.refreshTokenExpiresIn,
  );
  await deps.refreshTokenRepository.save(record);

  return { user: toUserDto(user), refreshToken };
}

export async function loginUser(deps: LoginDeps, input: LoginInput): Promise<AuthSession> {
  const user = await deps.userRepository.findByEmail(input.email);
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await deps.passwordHasher.verify(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const { refreshToken, record } = createRefreshTokenRecord(
    user.id,
    deps.refreshTokenExpiresIn,
  );
  await deps.refreshTokenRepository.save(record);

  return { user: toUserDto(user), refreshToken };
}

export async function refreshSession(
  deps: RefreshDeps,
  refreshToken: string,
): Promise<AuthSession> {
  const tokenHash = hashToken(refreshToken);
  const existing = await deps.refreshTokenRepository.findByTokenHash(tokenHash);

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  await deps.refreshTokenRepository.revoke(existing.id);

  const user = await deps.userRepository.findById(existing.userId);
  if (!user) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const { refreshToken: newRefreshToken, record } = createRefreshTokenRecord(
    user.id,
    deps.refreshTokenExpiresIn,
  );
  await deps.refreshTokenRepository.save(record);

  return { user: toUserDto(user), refreshToken: newRefreshToken };
}

export async function logoutUser(deps: LogoutDeps, refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  const existing = await deps.refreshTokenRepository.findByTokenHash(tokenHash);
  if (!existing || existing.revokedAt) {
    return;
  }
  await deps.refreshTokenRepository.revoke(existing.id);
}

export async function createApiKey(
  deps: CreateApiKeyDeps,
  userId: string,
  input: CreateApiKeyInput,
): Promise<ApiKeyDto> {
  const plaintextKey = `smriti_${randomBytes(32).toString('base64url')}`;
  const record = {
    id: randomUUID(),
    userId,
    keyHash: hashToken(plaintextKey),
    name: input.name,
    scopes: input.scopes ?? [],
    lastUsedAt: null,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    createdAt: new Date(),
  };

  await deps.apiKeyRepository.save(record);

  return {
    id: record.id,
    name: record.name,
    scopes: record.scopes,
    lastUsedAt: null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    key: plaintextKey,
  };
}

export async function revokeApiKey(
  deps: CreateApiKeyDeps,
  userId: string,
  apiKeyId: string,
): Promise<void> {
  const deleted = await deps.apiKeyRepository.delete(userId, apiKeyId);
  if (!deleted) {
    throw new NotFoundError('ApiKey', apiKeyId);
  }
}

export function toApiKeyDto(
  record: {
    id: string;
    name: string;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
  },
): ApiKeyDto {
  return {
    id: record.id,
    name: record.name,
    scopes: record.scopes,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}
