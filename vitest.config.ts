import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // A API usa decorators do NestJS; o SWC gera os metadados que o Vite sozinho não gera.
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'api',
          include: ['apps/api/{src,test}/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['apps/api/test/global-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
