import { describe, expect, it } from 'vitest';
import { Memory } from './memory.entity.js';

describe('Memory', () => {
  const baseParams = {
    userId: 'user-1',
    type: 'long_term' as const,
    content: 'I live in New York City',
  };

  it('creates a memory with defaults', () => {
    const memory = Memory.create(baseParams);
    expect(memory.id).toBeDefined();
    expect(memory.userId).toBe('user-1');
    expect(memory.type).toBe('long_term');
    expect(memory.content).toBe('I live in New York City');
    expect(memory.importance).toBe(0.5);
    expect(memory.confidence).toBe(0.8);
    expect(memory.isPinned).toBe(false);
    expect(memory.isArchived).toBe(false);
    expect(memory.contentHash).toHaveLength(64);
  });

  it('rejects empty content', () => {
    expect(() => Memory.create({ ...baseParams, content: '   ' })).toThrow(
      'Memory content cannot be empty',
    );
  });

  it('rejects pin and archive together on update', () => {
    const memory = Memory.create(baseParams);
    expect(() => memory.update({ isPinned: true, isArchived: true })).toThrow(
      'A memory cannot be both pinned and archived',
    );
  });

  it('rejects archiving a pinned memory', () => {
    const memory = Memory.create(baseParams);
    memory.update({ isPinned: true });
    expect(() => memory.update({ isArchived: true })).toThrow(
      'A memory cannot be both pinned and archived',
    );
  });

  it('rejects pinning an archived memory', () => {
    const memory = Memory.create(baseParams);
    memory.update({ isArchived: true });
    expect(() => memory.update({ isPinned: true })).toThrow(
      'A memory cannot be both pinned and archived',
    );
  });

  it('updates content and recomputes hash', () => {
    const memory = Memory.create(baseParams);
    const oldHash = memory.contentHash;
    memory.update({ content: 'I live in Boston' });
    expect(memory.content).toBe('I live in Boston');
    expect(memory.contentHash).not.toBe(oldHash);
  });
});
