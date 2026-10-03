import type { EmbeddingProvider } from '@smriti/domain';

export interface OpenAICompatibleEmbeddingOptions {
  baseUrl: string;
  model: string;
  dimension: number;
  apiKey?: string;
  batchSize?: number;
  timeoutMs?: number;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(opts: OpenAICompatibleEmbeddingOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.dimension = opts.dimension;
    this.apiKey = opts.apiKey;
    this.batchSize = opts.batchSize ?? 32;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const vectors = await this.embedBatch(batch);
      for (const v of vectors) {
        if (v.length !== this.dimension) {
          throw new Error(
            `Embedding dimension mismatch: expected ${this.dimension}, got ${v.length} (model ${this.model})`,
          );
        }
      }
      out.push(...vectors);
    }
    return out;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
        const res = await fetchWithTimeout(
          `${this.baseUrl}/embeddings`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: this.model, input: batch }),
          },
          this.timeoutMs,
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Embedding request failed (${res.status}): ${body.slice(0, 500)}`);
        }
        const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
        return json.data.map((d) => d.embedding);
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
