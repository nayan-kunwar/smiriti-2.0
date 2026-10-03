import type { Model, ModelOutput } from '@smriti/harness';

export type ScriptStep = { stop: true; text?: string } | { tool: string; args?: unknown };

export function scriptedModel(steps: ScriptStep[]): Model {
  let index = 0;
  return {
    async complete(): Promise<ModelOutput> {
      const step = steps[index];
      index += 1;
      if (!step || !('tool' in step)) {
        return { type: 'stop', text: step && 'text' in step ? step.text : undefined };
      }
      return { type: 'tool', call: { name: step.tool, args: step.args } };
    },
  };
}
