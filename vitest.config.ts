import { defineConfig } from 'vitest/config';

/**
 * Config raiz usada só para cobertura consolidada (npm run test:coverage).
 * Cada workspace continua com o próprio `vitest run` em `npm test`.
 */
export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/connectors', 'apps/api', 'apps/cli', 'apps/web'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts', 'apps/cli/src/**/*.ts', 'apps/web/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/main.ts', '**/server.ts'],
    },
  },
});
