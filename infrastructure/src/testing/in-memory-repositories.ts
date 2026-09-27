import { Memory, User } from '@smriti/domain';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  AuditLogEntry,
  AuditLogRecord,
  AuditLogRepository,
  ListAuditLogsQuery,
  ListMemoriesQuery,
  ListUsersQuery,
  MemoryRepository,
  PaginatedResult,
  RefreshTokenRecord,
  RefreshTokenRepository,
  UserRepository,
} from '@smriti/domain';

export class InMemoryMemoryRepository implements MemoryRepository {
  private store = new Map<string, Memory>();

  async save(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async findById(userId: string, id: string): Promise<Memory | null> {
    const memory = this.store.get(id);
    if (!memory || memory.userId !== userId) return null;
    return Memory.reconstitute(memory.toProps());
  }

  async findByUser(userId: string, query: ListMemoriesQuery): Promise<PaginatedResult<Memory>> {
    let items = [...this.store.values()].filter((m) => m.userId === userId);

    if (!query.includeArchived) {
      items = items.filter((m) => !m.isArchived);
    }
    if (query.category) {
      items = items.filter((m) => m.category === query.category);
    }
    if (query.tags?.length) {
      items = items.filter((m) => query.tags!.every((t) => m.tags.includes(t)));
    }
    if (query.isPinned !== undefined) {
      items = items.filter((m) => m.isPinned === query.isPinned);
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = items.findIndex((m) => m.id === query.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + query.limit);
    const nextCursor =
      startIndex + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: page.map((m) => Memory.reconstitute(m.toProps())),
      nextCursor,
    };
  }

  async update(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const memory = this.store.get(id);
    if (!memory || memory.userId !== userId) return false;
    return this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push({ ...entry, payloadSnapshot: { ...entry.payloadSnapshot } });
  }

  async findAll(
    query: ListAuditLogsQuery,
  ): Promise<{ items: AuditLogRecord[]; nextCursor: string | null }> {
    let items = this.entries.map((entry, index) => ({
      id: `audit-${index}`,
      createdAt: new Date(),
      ...entry,
    }));

    if (query.userId) {
      items = items.filter((entry) => entry.userId === query.userId);
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = items.findIndex((entry) => entry.id === query.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + query.limit);
    const nextCursor =
      startIndex + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return { items: page, nextCursor };
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export class InMemoryUserRepository implements UserRepository {
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

  async findAll(query: ListUsersQuery): Promise<PaginatedResult<User>> {
    const items = [...this.store.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = items.findIndex((user) => user.id === query.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + query.limit);
    const nextCursor =
      startIndex + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: page.map((user) => User.reconstitute(user.toProps())),
      nextCursor,
    };
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private store = new Map<string, RefreshTokenRecord>();

  async save(record: RefreshTokenRecord): Promise<void> {
    this.store.set(record.id, { ...record });
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const record of this.store.values()) {
      if (record.tokenHash === tokenHash) return { ...record };
    }
    return null;
  }

  async revoke(id: string): Promise<void> {
    const record = this.store.get(id);
    if (record) {
      this.store.set(id, { ...record, revokedAt: new Date() });
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  private store = new Map<string, ApiKeyRecord>();

  async save(record: ApiKeyRecord): Promise<void> {
    this.store.set(record.id, { ...record });
  }

  async findByKeyHash(keyHash: string): Promise<ApiKeyRecord | null> {
    for (const record of this.store.values()) {
      if (record.keyHash === keyHash) return { ...record };
    }
    return null;
  }

  async findById(userId: string, id: string): Promise<ApiKeyRecord | null> {
    const record = this.store.get(id);
    if (!record || record.userId !== userId) return null;
    return { ...record };
  }

  async findByUser(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.store.values()]
      .filter((record) => record.userId === userId)
      .map((record) => ({ ...record }));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const record = this.store.get(id);
    if (!record || record.userId !== userId) return false;
    return this.store.delete(id);
  }

  async updateLastUsed(id: string): Promise<void> {
    const record = this.store.get(id);
    if (record) {
      this.store.set(id, { ...record, lastUsedAt: new Date() });
    }
  }

  clear(): void {
    this.store.clear();
  }
}
