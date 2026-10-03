import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@smriti/harness': path.join(root, 'packages/harness/src/index.ts'),
    },
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/**/src/**/*.{spec,test}.ts',
      'infrastructure/**/src/**/*.{spec,test}.ts',
      'apps/**/src/**/*.{spec,test}.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
