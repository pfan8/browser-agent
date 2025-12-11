#!/usr/bin/env tsx
/**
 * E2E Test Runner with Debug Support
 * 
 * Provides two modes:
 * - Full mode (default): Build app first, then run tests
 * - Fast mode (--fast): Skip build, run tests directly
 * 
 * Outputs structured reports for Cursor Agent parsing.
 * 
 * Usage:
 *   pnpm test:e2e:debug       # Full mode (build + test)
 *   pnpm test:e2e:fast        # Fast mode (test only)
 */

import { spawn, execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Types
interface TestRunResult {
  success: boolean;
  mode: 'full' | 'fast';
  buildOutput?: string;
  buildError?: string;
  testOutput: string;
  report?: AgentReport;
  duration: number;
}

interface AgentReport {
  timestamp: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  tests: Array<{
    name: string;
    file: string;
    status: string;
    prdId?: string;
    error?: {
      message: string;
      suggestedFix: string;
    };
    screenshots: string[];
  }>;
  failedTests: Array<{
    name: string;
    prdId?: string;
    error?: {
      message: string;
      suggestedFix: string;
    };
    screenshots: string[];
  }>;
}

// Parse command line arguments
const args = process.argv.slice(2);
const mode: 'full' | 'fast' = args.includes('--fast') ? 'fast' : 'full';
const verbose = args.includes('--verbose') || args.includes('-v');

// Paths
const projectRoot = path.join(__dirname, '..');
const distElectron = path.join(projectRoot, 'dist-electron');
const mainJs = path.join(distElectron, 'main.js');
const reportPath = path.join(projectRoot, 'test-results', 'agent-report.json');

console.log('═'.repeat(60));
console.log(`  E2E Test Runner - ${mode.toUpperCase()} MODE`);
console.log('═'.repeat(60));
console.log(`Mode: ${mode === 'full' ? 'Build + Test' : 'Test Only (Skip Build)'}`);
console.log(`Verbose: ${verbose}`);
console.log('');

const startTime = Date.now();

async function runE2EWithDebug(): Promise<TestRunResult> {
  const result: TestRunResult = {
    success: false,
    mode,
    testOutput: '',
    duration: 0,
  };

  try {
    // Step 1: Build (only in full mode)
    if (mode === 'full') {
      console.log('📦 Step 1: Building Electron app...');
      console.log('-'.repeat(40));
      
      try {
        const buildResult = spawnSync('pnpm', ['build'], {
          cwd: projectRoot,
          stdio: verbose ? 'inherit' : 'pipe',
          encoding: 'utf-8',
          shell: true,
        });

        if (buildResult.status !== 0) {
          result.buildError = buildResult.stderr || buildResult.stdout || 'Build failed';
          console.error('❌ Build failed!');
          console.error(result.buildError);
          
          // Output error for agent
          console.log('\n===== E2E_SUMMARY_START =====');
          console.log(JSON.stringify({
            success: false,
            mode,
            error: 'Build failed',
            buildError: result.buildError,
            suggestedFix: 'Check TypeScript errors with: pnpm tsc --noEmit',
          }, null, 2));
          console.log('===== E2E_SUMMARY_END =====');
          
          return result;
        }

        result.buildOutput = buildResult.stdout || '';
        console.log('✅ Build successful!');
        console.log('');
      } catch (buildErr) {
        result.buildError = String(buildErr);
        console.error('❌ Build error:', buildErr);
        return result;
      }
    } else {
      console.log('⏩ Step 1: Skipping build (fast mode)');
      
      // Check if build exists
      if (!fs.existsSync(mainJs)) {
        console.error('❌ Error: dist-electron/main.js not found!');
        console.error('   Run "pnpm test:e2e:debug" (without --fast) to build first.');
        
        console.log('\n===== E2E_SUMMARY_START =====');
        console.log(JSON.stringify({
          success: false,
          mode,
          error: 'Build artifacts not found',
          suggestedFix: 'Run "pnpm test:e2e:debug" to build the app first',
        }, null, 2));
        console.log('===== E2E_SUMMARY_END =====');
        
        return result;
      }
      console.log('✅ Build artifacts found');
      console.log('');
    }

    // Step 2: Run E2E tests
    console.log('🧪 Step 2: Running E2E tests...');
    console.log('-'.repeat(40));

    // Clear previous report
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }

    // Run playwright
    const testProcess = spawn('npx', ['playwright', 'test'], {
      cwd: projectRoot,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let testOutput = '';

    testProcess.stdout.on('data', (data) => {
      const text = data.toString();
      testOutput += text;
      process.stdout.write(text);
    });

    testProcess.stderr.on('data', (data) => {
      const text = data.toString();
      testOutput += text;
      process.stderr.write(text);
    });

    // Wait for test completion
    const exitCode = await new Promise<number>((resolve) => {
      testProcess.on('close', (code) => {
        resolve(code || 0);
      });
    });

    result.testOutput = testOutput;
    result.success = exitCode === 0;

    console.log('');
    console.log('-'.repeat(40));
    console.log(result.success ? '✅ Tests passed!' : '❌ Tests failed!');
    console.log('');

    // Step 3: Read and output report
    console.log('📊 Step 3: Generating report...');
    console.log('-'.repeat(40));

    if (fs.existsSync(reportPath)) {
      try {
        result.report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      } catch {
        console.log('Warning: Could not parse agent-report.json');
      }
    }

    // Calculate duration
    result.duration = Date.now() - startTime;

    // Output final summary for agent
    console.log('');
    console.log('===== E2E_SUMMARY_START =====');
    console.log(JSON.stringify({
      success: result.success,
      mode: result.mode,
      duration: `${(result.duration / 1000).toFixed(2)}s`,
      summary: result.report?.summary || {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      },
      failedTests: result.report?.failedTests?.map(t => ({
        name: t.name,
        prdId: t.prdId,
        error: t.error?.message,
        suggestedFix: t.error?.suggestedFix,
        screenshot: t.screenshots?.[0],
      })) || [],
    }, null, 2));
    console.log('===== E2E_SUMMARY_END =====');

    return result;

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    
    result.duration = Date.now() - startTime;
    
    console.log('\n===== E2E_SUMMARY_START =====');
    console.log(JSON.stringify({
      success: false,
      mode,
      error: String(error),
      suggestedFix: 'Check the error message above and fix the issue',
    }, null, 2));
    console.log('===== E2E_SUMMARY_END =====');
    
    return result;
  }
}

// Run
runE2EWithDebug()
  .then((result) => {
    console.log('');
    console.log('═'.repeat(60));
    console.log(`  Test run complete (${(result.duration / 1000).toFixed(2)}s)`);
    console.log('═'.repeat(60));
    
    process.exit(result.success ? 0 : 1);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

