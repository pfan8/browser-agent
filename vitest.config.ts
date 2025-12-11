import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', 'dist-electron', '__tests__'],
    },
    testTimeout: 10000,
    // Use forks instead of threads to avoid orphan processes with vm2
    // vm2 uses synchronous blocking that can leave worker_threads in uninterruptible state
    pool: 'forks',
    poolOptions: {
      forks: {
        // Allow forked processes to be killed properly on Ctrl+C
        isolate: true,
      },
    },
    // Ensure proper cleanup on test exit
    teardownTimeout: 5000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@electron': path.resolve(__dirname, './electron'),
      '@dsl': path.resolve(__dirname, './dsl'),
    },
  },
});

