export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Hint for providers that support structured output. */
  responseFormat?: 'text' | 'json';
}

export interface ChatModel {
  complete(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string>;
  readonly model: string;
}
