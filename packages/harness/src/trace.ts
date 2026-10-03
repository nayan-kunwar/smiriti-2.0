import type { TraceEvent } from './types.js';

export function traceToJsonl(events: TraceEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '');
}

export function parseJsonl(text: string): TraceEvent[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TraceEvent);
}
