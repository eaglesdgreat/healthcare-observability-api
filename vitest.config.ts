import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    exclude: ['test/**/*.integration.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  plugins: [
    // SWC handles TypeScript parameter decorators and emitDecoratorMetadata needed by NestJS
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});