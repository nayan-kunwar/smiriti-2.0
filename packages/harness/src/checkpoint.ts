import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointState, CheckpointStore } from './types.js';

export function memoryCheckpointStore(): CheckpointStore {
  const states = new Map<string, CheckpointState>();
  return {
    async load(runId: string) {
      return states.get(runId) ?? null;
    },
    async save(state: CheckpointState) {
      states.set(state.runId, structuredClone(state));
    },
  };
}

export function fileCheckpointStore(dir: string): CheckpointStore {
  return {
    async load(runId: string) {
      try {
        const raw = await readFile(checkpointPath(dir, runId), 'utf8');
        return JSON.parse(raw) as CheckpointState;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async save(state: CheckpointState) {
      await mkdir(dir, { recursive: true });
      await writeFile(checkpointPath(dir, state.runId), JSON.stringify(state));
    },
  };
}

function checkpointPath(dir: string, runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(dir, `${safe}.json`);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
