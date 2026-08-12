import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

// Do not hardcode index.js: match graphql-relay's conditional-export realm.
const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^graphql$/,
        replacement: require.resolve('graphql')
      }
    ]
  },
  test: {
    globals: false,
    include: [
      'test/unit/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/package-smoke.test.ts'
    ]
  }
});
