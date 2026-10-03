import type { Message } from './types.js';

const DROP_PREFIX = 'Dropped ';

export function compactMessages(messages: Message[], maxChars: number): Message[] {
  const withoutNotes = messages.filter((message) => !isDropNote(message));
  const dropped: string[] = [];
  const kept = [...withoutNotes];

  while (serializedLength(kept) > maxChars) {
    const index = kept.findIndex((message) => message.role === 'tool');
    if (index === -1) break;
    dropped.push(kept[index]?.name ?? 'tool');
    kept.splice(index, 1);
  }

  if (dropped.length === 0) return withoutNotes;

  const note: Message = {
    role: 'system',
    content: `${DROP_PREFIX}${dropped.length} tool results: ${dropped.join(', ')}`,
  };
  return [note, ...kept];
}

function serializedLength(messages: Message[]): number {
  return JSON.stringify(messages).length;
}

function isDropNote(message: Message): boolean {
  return message.role === 'system' && message.content.startsWith(DROP_PREFIX);
}
