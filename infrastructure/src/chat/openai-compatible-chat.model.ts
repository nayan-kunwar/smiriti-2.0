import type { ChatCompletionOptions, ChatMessage, ChatModel } from '@smriti/domain';

export interface OpenAICompatibleChatOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class OpenAICompatibleChatModel implements ChatModel {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(opts: OpenAICompatibleChatOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async complete(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      temperature: options?.temperature ?? 0.2,
    };
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Chat completion failed (${res.status}): ${text.slice(0, 500)}`);
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('Chat completion returned no message content');
        }
        return content;
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
