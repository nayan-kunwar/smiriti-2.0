export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RefreshTokenRepository {
  save(record: RefreshTokenRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string): Promise<void>;
}
