import type { Expectation } from './task.js';
import { scoreTask } from './score.js';

export interface ChatMemoryView {
  id: string;
  content: string;
  type: 'long_term' | 'semantic';
  tags: string[];
}

export interface ChatOutcome {
  status: 'completed' | 'failed';
  response: string;
  memories: ChatMemoryView[];
  memoriesCreated: number;
  retrieved: ChatMemoryView[];
  duplicateCount: number;
  conversationMessages: number;
  expect: Expectation;
  error?: string;
}

export function scoreChatTask(outcome: ChatOutcome): {
  passed: boolean;
  failures: string[];
} {
  const failures = scoreTask({
    status: outcome.status,
    trace: [],
    memories: outcome.memories,
    expect: outcome.expect,
  }).failures;

  if (outcome.error) failures.push(outcome.error);

  for (const expected of outcome.expect.responseIncludes ?? []) {
    if (!outcome.response.includes(expected)) {
      failures.push(`response missing "${expected}"`);
    }
  }

  if (
    outcome.expect.memoriesCreated !== undefined &&
    outcome.memoriesCreated !== outcome.expect.memoriesCreated
  ) {
    failures.push(
      `memories created ${outcome.memoriesCreated} != ${outcome.expect.memoriesCreated}`,
    );
  }

  if (
    outcome.expect.conversationMessages !== undefined &&
    outcome.conversationMessages !== outcome.expect.conversationMessages
  ) {
    failures.push(
      `conversation messages ${outcome.conversationMessages} != ${outcome.expect.conversationMessages}`,
    );
  }

  if (
    outcome.expect.duplicateCount !== undefined &&
    outcome.duplicateCount !== outcome.expect.duplicateCount
  ) {
    failures.push(
      `duplicate warnings ${outcome.duplicateCount} != ${outcome.expect.duplicateCount}`,
    );
  }

  for (const expected of outcome.expect.retrievedContains ?? []) {
    if (!outcome.retrieved.some((memory) => memory.content.includes(expected))) {
      failures.push(`retrieved memories missing "${expected}"`);
    }
  }

  return { passed: failures.length === 0, failures };
}
