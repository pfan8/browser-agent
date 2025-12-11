import { defineConfig } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: './e2e',
  
  // Run tests sequentially for Electron
  fullyParallel: false,
  workers: 1,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'test-results/html-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    // Custom agent-friendly reporter
    ['./e2e/reporters/agent-reporter.ts'],
  ],
  
  // Shared settings for all tests
  use: {
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    // Take screenshot on failure
    screenshot: 'on',
    // Record video on first retry
    video: 'on-first-retry',
  },
  
  // Timeout settings
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  
  // Output directory for test artifacts
  outputDir: 'test-results/artifacts',
  
  // Projects configuration
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
    },
  ],
});

