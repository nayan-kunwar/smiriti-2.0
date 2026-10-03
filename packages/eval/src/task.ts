import { z } from 'zod';
import { resolvePolicy } from '@smriti/harness';
import type { Policy } from '@smriti/harness';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  name: z.string().optional(),
});

const ScriptStepSchema = z.union([
  z.object({ stop: z.literal(true), text: z.string().optional() }),
  z.object({ tool: z.string().min(1), args: z.unknown() }),
]);

export const ExpectationSchema = z.object({
  status: z.enum(['completed', 'cancelled', 'failed']),
  toolCalls: z
    .array(
      z.object({
        name: z.string(),
        argsIncludes: z.record(z.string()).optional(),
      }),
    )
    .optional(),
  forbiddenTools: z.array(z.string()).optional(),
  memoryCount: z.number().int().nonnegative().optional(),
  memories: z
    .array(
      z.object({
        contentIncludes: z.string().optional(),
        type: z.enum(['long_term', 'semantic']).optional(),
      }),
    )
    .optional(),
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  suite: z.string().min(1),
  seed: z.number().int(),
  input: z.object({ messages: z.array(MessageSchema).min(1) }),
  fixtures: z
    .object({
      memories: z
        .array(
          z.object({
            content: z.string().min(1),
            type: z.enum(['long_term', 'semantic']),
            tags: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  scriptedModel: z.array(ScriptStepSchema).min(1).optional(),
  policy: z
    .object({
      maxSteps: z.number().int().positive().optional(),
      timeoutMs: z.number().int().positive().optional(),
      maxRetries: z.number().int().nonnegative().optional(),
      maxContextChars: z.number().int().positive().optional(),
    })
    .optional(),
  resumeAfterStep: z.number().int().positive().optional(),
  hangTool: z.string().optional(),
  injectFailures: z
    .array(
      z.object({
        tool: z.string(),
        times: z.number().int().positive(),
      }),
    )
    .optional(),
  expect: ExpectationSchema,
});

export type Expectation = z.infer<typeof ExpectationSchema>;
export type EvalTask = z.infer<typeof TaskSchema>;

export function taskPolicy(task: EvalTask): Policy {
  return resolvePolicy(task.policy);
}
