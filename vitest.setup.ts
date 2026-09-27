process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-min-16-chars';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://smriti:smriti@localhost:5433/smriti?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
process.env.QDRANT_COLLECTION = process.env.QDRANT_COLLECTION ?? 'smriti_test';
process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'ollama';
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? 'ollama';
