import { defineConfig } from 'vitest/config';

export default defineConfig({
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
