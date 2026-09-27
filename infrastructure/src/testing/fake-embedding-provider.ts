import type { EmbeddingProvider } from '@smriti/domain';

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-embed';
  readonly dimension = 4;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      let h = 0;
      for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 1000;
      const base = h / 1000;
      return [base, base * 0.5, base * 0.25, 1 - base];
    });
  }
}
