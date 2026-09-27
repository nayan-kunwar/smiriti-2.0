import { describe, expect, it } from 'vitest';
import { chunkMemoryContent, estimateTokens, qdrantPointId } from './chunking.js';

describe('chunking', () => {
  it('keeps short content atomic', () => {
    const chunks = chunkMemoryContent('I live in NYC');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].tokenCount).toBeLessThanOrEqual(500);
  });

  it('splits long content with overlap', () => {
    const content = 'a'.repeat(900 * 4 + 100);
    const chunks = chunkMemoryContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(estimateTokens(chunks[0].text)).toBeLessThanOrEqual(1000);
  });

  it('builds qdrant point ids', () => {
    expect(qdrantPointId('mem-1', 0)).toBe('mem-1');
    expect(qdrantPointId('mem-1', 2)).toBe('mem-1_2');
  });
});
