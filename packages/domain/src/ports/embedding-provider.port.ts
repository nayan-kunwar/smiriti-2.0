export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly model: string;
  readonly dimension: number;
  /** Maximum estimated tokens the provider accepts in one input. */
  readonly maxInputTokens: number;
}
