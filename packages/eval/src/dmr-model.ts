import type { Message, Model, ModelOutput } from '@smriti/harness';

export interface DmrModelOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export const DEFAULT_DMR_BASE_URL = 'http://localhost:12434/engines/v1';
export const DEFAULT_DMR_CHAT_MODEL = 'docker.io/ai/qwen2.5:3B-Q4_K_M';

const TOOL_FENCE = '```tool';

function toolPrompt(): string {
  return [
    'You are a memory assistant with access to tools: memory.create, memory.search, memory.list.',
    'Reply with exactly one of:',
    '1. Plain text to stop and answer the user.',
    `2. A tool call inside a ${TOOL_FENCE} fenced JSON block:`,
    '```tool',
    '{"name": "memory.create", "args": {"content": "...", "type": "semantic"}}',
    '```',
    'Emit at most one tool call per reply. Never invent other tools.',
    'Example — user says "I live in Pune", you reply with only:',
    '```tool',
    '{"name": "memory.create", "args": {"content": "User lives in Pune.", "type": "semantic"}}',
    '```',
  ].join('\n');
}

function toOpenAiMessages(messages: Message[]): Array<{ role: string; content: string }> {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'user', content: `[tool:${message.name ?? 'result'}] ${message.content}` };
    }
    return { role: message.role, content: message.content };
  });
}

export function parseToolCall(text: string): { name: string; args: unknown } | null {
  const start = text.indexOf(TOOL_FENCE);
  if (start === -1) return null;
  const body = text.slice(start + TOOL_FENCE.length);
  const end = body.indexOf('```');
  const jsonText = (end === -1 ? body : body.slice(0, end)).trim();
  try {
    const parsed = JSON.parse(jsonText) as { name?: unknown; args?: unknown };
    if (typeof parsed.name !== 'string' || !parsed.name) return null;
    return { name: parsed.name, args: parsed.args ?? {} };
  } catch {
    return null;
  }
}

export function dmrModel(options: DmrModelOptions = {}): Model {
  const baseUrl = (options.baseUrl ?? process.env.DMR_BASE_URL ?? DEFAULT_DMR_BASE_URL).replace(
    /\/$/,
    '',
  );
  const model = options.model ?? process.env.DMR_CHAT_MODEL ?? DEFAULT_DMR_CHAT_MODEL;
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    async complete(messages: Message[]): Promise<ModelOutput> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: toolPrompt() }, ...toOpenAiMessages(messages)],
          }),
        });
        if (!res.ok) {
          throw new Error(`DMR chat request failed (${res.status})`);
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = json.choices?.[0]?.message?.content ?? '';
        const call = parseToolCall(text);
        if (call) return { type: 'tool', call };
        return { type: 'stop', text };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
