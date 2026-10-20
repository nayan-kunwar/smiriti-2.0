import type { ChatModel } from '@smriti/domain';
import type { AppConfig } from '@smriti/shared';
import { OpenAICompatibleChatModel } from './openai-compatible-chat.model.js';

export function createChatModel(config: AppConfig): ChatModel {
  switch (config.LLM_PROVIDER) {
    case 'dmr':
      return new OpenAICompatibleChatModel({
        baseUrl: config.DMR_BASE_URL,
        model: config.DMR_CHAT_MODEL,
      });
    case 'ollama':
      return new OpenAICompatibleChatModel({
        baseUrl: `${config.OLLAMA_BASE_URL.replace(/\/$/, '')}/v1`,
        model: config.OLLAMA_CHAT_MODEL,
      });
    case 'openai':
      return new OpenAICompatibleChatModel({
        baseUrl: 'https://api.openai.com/v1',
        model: config.OPENAI_CHAT_MODEL,
        apiKey: config.OPENAI_API_KEY,
      });
    default:
      throw new Error(`Unsupported LLM provider: ${String(config.LLM_PROVIDER)}`);
  }
}
