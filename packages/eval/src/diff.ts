import type { TraceEvent } from '@smriti/harness';

export function diffTraces(left: TraceEvent[], right: TraceEvent[]): string | null {
  const a = left.filter((event) => event.type === 'tool.call');
  const b = right.filter((event) => event.type === 'tool.call');
  const count = Math.max(a.length, b.length);

  for (let index = 0; index < count; index += 1) {
    const first = a[index];
    const second = b[index];
    if (!first || !second) {
      const step = first?.step ?? second?.step ?? index;
      return `step ${step}: tool call missing on one side`;
    }
    if (first.tool !== second.tool || JSON.stringify(first.args) !== JSON.stringify(second.args)) {
      return `step ${first.step}: ${first.tool} ${JSON.stringify(first.args)} != ${second.tool} ${JSON.stringify(second.args)}`;
    }
  }

  return null;
}
