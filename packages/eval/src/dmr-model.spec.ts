import { describe, expect, it } from 'vitest';
import { parseToolCall } from './dmr-model.js';

describe('parseToolCall', () => {
  it('parses a fenced tool block', () => {
    const call = parseToolCall(
      'Let me save that.\n```tool\n{"name": "memory.create", "args": {"content": "User lives in Pune."}}\n```',
    );
    expect(call).toEqual({
      name: 'memory.create',
      args: { content: 'User lives in Pune.' },
    });
  });

  it('returns null for plain text', () => {
    expect(parseToolCall('I found a note about Pune.')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseToolCall('```tool\n{not json\n```')).toBeNull();
  });

  it('returns null when name is missing', () => {
    expect(parseToolCall('```tool\n{"args": {}}\n```')).toBeNull();
  });
});
