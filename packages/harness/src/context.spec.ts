import { describe, expect, it } from 'vitest';
import { compactMessages } from './context.js';
import type { Message } from './types.js';

describe('compactMessages', () => {
  it('drops the oldest tool results and keeps a note', () => {
    const messages: Message[] = [
      { role: 'user', content: 'remember this' },
      { role: 'tool', name: 'memory.create', content: 'x'.repeat(200) },
      { role: 'tool', name: 'memory.search', content: 'y'.repeat(200) },
    ];

    const compacted = compactMessages(messages, 120);

    expect(compacted[0]?.role).toBe('system');
    expect(compacted[0]?.content).toContain('Dropped');
    expect(compacted.some((message) => message.content.includes('xxx'))).toBe(false);
    expect(compacted.some((message) => message.role === 'user')).toBe(true);
  });

  it('leaves short context unchanged', () => {
    const messages: Message[] = [{ role: 'user', content: 'hi' }];
    expect(compactMessages(messages, 500)).toEqual(messages);
  });
});
