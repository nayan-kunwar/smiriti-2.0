export interface ApiKeyRecord {
  id: string;
  userId: string;
  keyHash: string;
  name: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ApiKeyRepository {
  save(record: ApiKeyRecord): Promise<void>;
  findByKeyHash(keyHash: string): Promise<ApiKeyRecord | null>;
  findById(userId: string, id: string): Promise<ApiKeyRecord | null>;
  findByUser(userId: string): Promise<ApiKeyRecord[]>;
  delete(userId: string, id: string): Promise<boolean>;
  updateLastUsed(id: string): Promise<void>;
}
