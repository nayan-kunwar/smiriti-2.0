import type { AppConfig } from '@smriti/shared';
import type { EmbeddingProvider } from '@smriti/domain';
import { OpenAICompatibleEmbeddingProvider } from './openai-compatible-embedding.provider.js';

export function createEmbeddingProvider(config: AppConfig): EmbeddingProvider {
  switch (config.EMBEDDING_PROVIDER) {
    case 'dmr':
      return new OpenAICompatibleEmbeddingProvider({
        baseUrl: config.DMR_BASE_URL,
        model: config.DMR_EMBED_MODEL,
        dimension: 768,
      });
    case 'openai':
      return new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'https://api.openai.com/v1',
        model: config.OPENAI_EMBED_MODEL,
        dimension: 1536,
        apiKey: config.OPENAI_API_KEY,
      });
    case 'ollama':
    default:
      return new OpenAICompatibleEmbeddingProvider({
        baseUrl: `${config.OLLAMA_BASE_URL.replace(/\/$/, '')}/v1`,
        model: config.OLLAMA_EMBED_MODEL,
        dimension: 768,
      });
  }
}
