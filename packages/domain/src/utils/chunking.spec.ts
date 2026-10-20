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

  it('honors a provider input limit', () => {
    const content = 'a'.repeat(5000);
    const chunks = chunkMemoryContent(content, 400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(400);
    }
  });

  it('builds qdrant point ids', () => {
    expect(qdrantPointId('mem-1', 0)).toBe('mem-1');
    const id = qdrantPointId('00000000-0000-0000-0000-000000000000', 2);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(qdrantPointId('00000000-0000-0000-0000-000000000000', 2)).toBe(id);
  });
});
