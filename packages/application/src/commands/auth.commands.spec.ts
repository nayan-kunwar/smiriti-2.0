import { describe, expect, it } from 'vitest';
import { User } from '@smriti/domain';
import type {
  ApiKeyRepository,
  PasswordHasher,
  RefreshTokenRepository,
  UserRepository,
} from '@smriti/domain';
import {
  createApiKey,
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
  revokeApiKey,
} from './auth.commands.js';

class FakePasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `hashed:${password}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    return hash === `hashed:${password}`;
  }
}

class InMemoryUserRepository implements UserRepository {
  private store = new Map<string, User>();

  async save(user: User): Promise<void> {
    this.store.set(user.id, User.reconstitute(user.toProps()));
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    for (const user of this.store.values()) {
      if (user.email === normalized) return User.reconstitute(user.toProps());
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    const user = this.store.get(id);
    return user ? User.reconstitute(user.toProps()) : null;
  }

  async findAll() {
    return { items: [...this.store.values()], nextCursor: null };
  }
}

class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private store = new Map<string, import('@smriti/domain').RefreshTokenRecord>();

  async save(record: import('@smriti/domain').RefreshTokenRecord): Promise<void> {
    this.store.set(record.id, { ...record });
  }

  async findByTokenHash(tokenHash: string) {
    for (const record of this.store.values()) {
      if (record.tokenHash === tokenHash) return { ...record };
    }
    return null;
  }

  async revoke(id: string): Promise<void> {
    const record = this.store.get(id);
    if (record) this.store.set(id, { ...record, revokedAt: new Date() });
  }
}

class InMemoryApiKeyRepository implements ApiKeyRepository {
  private store = new Map<string, import('@smriti/domain').ApiKeyRecord>();

  async save(record: import('@smriti/domain').ApiKeyRecord): Promise<void> {
    this.store.set(record.id, { ...record });
  }

  async findByKeyHash(keyHash: string) {
    for (const record of this.store.values()) {
      if (record.keyHash === keyHash) return { ...record };
    }
    return null;
  }

  async findById(userId: string, id: string) {
    const record = this.store.get(id);
    return record && record.userId === userId ? { ...record } : null;
  }

  async findByUser(userId: string) {
    return [...this.store.values()].filter((record) => record.userId === userId);
  }

  async delete(userId: string, id: string) {
    const record = this.store.get(id);
    if (!record || record.userId !== userId) return false;
    return this.store.delete(id);
  }

  async updateLastUsed(id: string): Promise<void> {
    const record = this.store.get(id);
    if (record) this.store.set(id, { ...record, lastUsedAt: new Date() });
  }
}

describe('Auth use cases', () => {
  const passwordHasher = new FakePasswordHasher();
  const refreshTokenExpiresIn = '7d';

  function deps() {
    return {
      userRepository: new InMemoryUserRepository(),
      refreshTokenRepository: new InMemoryRefreshTokenRepository(),
      apiKeyRepository: new InMemoryApiKeyRepository(),
      passwordHasher,
      refreshTokenExpiresIn,
    };
  }

  it('registers, logs in, refreshes, and logs out', async () => {
    const authDeps = deps();

    const registered = await registerUser(authDeps, {
      email: 'user@example.com',
      password: 'password123',
    });
    expect(registered.user.email).toBe('user@example.com');
    expect(registered.refreshToken.length).toBeGreaterThan(10);

    const loggedIn = await loginUser(authDeps, {
      email: 'user@example.com',
      password: 'password123',
    });
    expect(loggedIn.user.id).toBe(registered.user.id);

    const refreshed = await refreshSession(
      {
        userRepository: authDeps.userRepository,
        refreshTokenRepository: authDeps.refreshTokenRepository,
        refreshTokenExpiresIn,
      },
      loggedIn.refreshToken,
    );
    expect(refreshed.user.id).toBe(registered.user.id);
    expect(refreshed.refreshToken).not.toBe(loggedIn.refreshToken);

    await logoutUser(
      { refreshTokenRepository: authDeps.refreshTokenRepository },
      refreshed.refreshToken,
    );
  });

  it('creates and revokes API keys', async () => {
    const authDeps = deps();
    const user = User.create({
      email: 'api@example.com',
      passwordHash: 'hashed',
    });
    await authDeps.userRepository.save(user);

    const created = await createApiKey(
      { apiKeyRepository: authDeps.apiKeyRepository },
      user.id,
      { name: 'ci-key', scopes: ['memories:read'] },
    );
    expect(created.key).toMatch(/^smriti_/);

    await revokeApiKey(
      { apiKeyRepository: authDeps.apiKeyRepository },
      user.id,
      created.id,
    );
  });
});
