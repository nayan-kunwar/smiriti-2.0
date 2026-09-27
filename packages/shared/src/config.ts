import { z } from 'zod';

export const EmbeddingProviderSchema = z.enum(['ollama', 'openai', 'dmr']);
export const LlmProviderSchema = z.enum(['ollama', 'openai', 'dmr']);

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
    REDIS_URL: z.string().url().or(z.string().startsWith('redis://')),
    QDRANT_URL: z.string().url(),
    QDRANT_COLLECTION: z.string().min(1).default('smriti_dev'),
    EMBEDDING_PROVIDER: EmbeddingProviderSchema.default('ollama'),
    OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
    OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
    DMR_BASE_URL: z.string().url().default('http://localhost:12434/engines/v1'),
    DMR_EMBED_MODEL: z.string().default('docker.io/ai/nomic-embed-text-v1.5:latest'),
    DMR_CHAT_MODEL: z.string().default('docker.io/ai/qwen2.5:3B-Q4_K_M'),
    LLM_PROVIDER: LlmProviderSchema.default('openai'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),
    OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
    JWT_SECRET: z.string().min(16),
    JWT_EXPIRES_IN: z.string().default('15m'),
    REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
    RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().default('smriti'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    CORRELATION_ID_HEADER: z.string().default('x-correlation-id'),
  })
  .superRefine((data, ctx) => {
    if (data.EMBEDDING_PROVIDER === 'openai' && !data.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai',
        path: ['OPENAI_API_KEY'],
      });
    }
    if (data.LLM_PROVIDER === 'openai' && !data.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OPENAI_API_KEY is required when LLM_PROVIDER=openai',
        path: ['OPENAI_API_KEY'],
      });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${messages.join('\n')}`);
  }
  return result.data;
}
