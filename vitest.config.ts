import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  plugins: [
    tsconfigPaths(),
    // SWC handles TypeScript parameter decorators and emitDecoratorMetadata needed by NestJS
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});