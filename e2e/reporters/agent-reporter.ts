/**
 * Agent-Friendly Test Reporter
 * 
 * Outputs test results in a format that Cursor Agent can easily parse:
 * - JSON structure with clear markers
 * - Suggested fixes for common failures
 * - Screenshot paths for visual debugging
 * - Code locations for quick navigation
 */

import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
  Suite,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

// Types for agent report
interface AgentTestResult {
  name: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  duration: number;
  prdId?: string;
  error?: {
    message: string;
    stack?: string;
    suggestedFix: string;
    codeLocation?: {
      file: string;
      line: number;
    };
  };
  screenshots: string[];
  logs: string[];
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
  tests: AgentTestResult[];
  failedTests: AgentTestResult[];
  diagnostics: {
    buildStatus: 'success' | 'failed' | 'unknown';
    electronLaunched: boolean;
    suggestions: string[];
  };
}

class AgentReporter implements Reporter {
  private results: AgentTestResult[] = [];
  private startTime: number = 0;
  private electronLaunched: boolean = false;

  onBegin(_config: unknown, _suite: Suite) {
    this.startTime = Date.now();
    this.results = [];
    this.electronLaunched = false;
  }

  onTestBegin(_test: TestCase) {
    // Mark that at least one test started (implies Electron launched)
    this.electronLaunched = true;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    // Extract PRD ID from test name (e.g., "BC-01: should connect via CDP")
    const prdMatch = test.title.match(/^([A-Z]+-\d+):/);
    
    const testResult: AgentTestResult = {
      name: test.title,
      file: test.location.file,
      status: result.status as AgentTestResult['status'],
      duration: result.duration,
      prdId: prdMatch?.[1],
      screenshots: [],
      logs: [],
    };

    // Collect screenshots
    if (result.attachments) {
      testResult.screenshots = result.attachments
        .filter(a => a.contentType?.startsWith('image/'))
        .map(a => a.path || '')
        .filter(p => p);

      // Collect logs
      testResult.logs = result.attachments
        .filter(a => a.name === 'stdout' || a.name === 'stderr')
        .map(a => a.body?.toString() || '')
        .filter(l => l);
    }

    // Handle failures
    if (result.status === 'failed' && result.error) {
      testResult.error = {
        message: result.error.message || 'Unknown error',
        stack: result.error.stack,
        suggestedFix: this.generateSuggestedFix(result.error, test.title),
        codeLocation: this.extractCodeLocation(result.error.stack),
      };
    }

    this.results.push(testResult);
  }

  onEnd(result: FullResult) {
    const totalDuration = Date.now() - this.startTime;
    const failedTests = this.results.filter(r => r.status === 'failed');

    const report: AgentReport = {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.status === 'passed').length,
        failed: failedTests.length,
        skipped: this.results.filter(r => r.status === 'skipped').length,
        duration: totalDuration,
      },
      tests: this.results,
      failedTests,
      diagnostics: {
        buildStatus: this.electronLaunched ? 'success' : 'unknown',
        electronLaunched: this.electronLaunched,
        suggestions: this.generateGlobalSuggestions(failedTests),
      },
    };

    // Ensure output directory exists
    const outputDir = path.join(process.cwd(), 'test-results');
    fs.mkdirSync(outputDir, { recursive: true });

    // Write JSON report
    const reportPath = path.join(outputDir, 'agent-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Output to console with clear markers for Agent parsing
    console.log('\n===== AGENT_TEST_REPORT_START =====');
    console.log(JSON.stringify(report, null, 2));
    console.log('===== AGENT_TEST_REPORT_END =====\n');

    // Output summary for quick reading
    console.log('===== E2E_SUMMARY_START =====');
    console.log(JSON.stringify({
      success: result.status === 'passed',
      total: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      failedTests: failedTests.map(t => ({
        name: t.name,
        prdId: t.prdId,
        error: t.error?.message,
        suggestedFix: t.error?.suggestedFix,
        screenshot: t.screenshots[0],
        codeLocation: t.error?.codeLocation,
      })),
    }, null, 2));
    console.log('===== E2E_SUMMARY_END =====');
  }

  /**
   * Generate suggested fix based on error type
   */
  private generateSuggestedFix(error: { message?: string; stack?: string }, testName: string): string {
    const msg = error.message?.toLowerCase() || '';
    const stack = error.stack?.toLowerCase() || '';

    // Timeout errors
    if (msg.includes('timeout') || msg.includes('timed out')) {
      if (msg.includes('waiting for locator')) {
        return 'Element not found within timeout. Check if:\n' +
               '1. The selector is correct (use data-testid or more specific selector)\n' +
               '2. The element exists in DOM (may need to scroll into view)\n' +
               '3. Increase timeout if loading is slow';
      }
      return 'Operation timed out. Consider:\n' +
             '1. Adding explicit waitFor before interaction\n' +
             '2. Increasing timeout value\n' +
             '3. Checking if the app is responsive';
    }

    // Element not found
    if (msg.includes('not found') || msg.includes('no element') || msg.includes('locator resolved to')) {
      return 'Element not found. Try:\n' +
             '1. Using data-testid attribute for reliable selection\n' +
             '2. Checking if element is rendered (conditional rendering issue?)\n' +
             '3. Using page.waitForSelector() before interaction';
    }

    // Visibility issues
    if (msg.includes('not visible') || msg.includes('hidden')) {
      return 'Element is not visible. Consider:\n' +
             '1. Waiting for element to be visible: waitForSelector(selector, { state: "visible" })\n' +
             '2. Scrolling element into view\n' +
             '3. Checking if element is behind a modal or overlay';
    }

    // Connection errors
    if (msg.includes('connection refused') || msg.includes('econnrefused')) {
      return 'Connection refused. Ensure:\n' +
             '1. Electron app is built: pnpm build\n' +
             '2. No other Electron instance is running\n' +
             '3. Port is not blocked';
    }

    // IPC errors
    if (msg.includes('ipc') || msg.includes('preload')) {
      return 'IPC communication error. Check:\n' +
             '1. preload.ts exposes the required API\n' +
             '2. main.ts registers the IPC handler\n' +
             '3. contextIsolation settings in webPreferences';
    }

    // Electron launch errors
    if (msg.includes('electron') || msg.includes('launch')) {
      return 'Electron launch failed. Try:\n' +
             '1. Rebuild the app: pnpm build\n' +
             '2. Check if dist-electron/main.js exists\n' +
             '3. Look for syntax errors in main.ts';
    }

    // Browser connection (CDP)
    if (msg.includes('cdp') || msg.includes('9222') || msg.includes('browser not connected')) {
      return 'Browser connection issue. Ensure:\n' +
             '1. Chrome is running with --remote-debugging-port=9222\n' +
             '2. No other process is using port 9222\n' +
             '3. Chrome was started before the test';
    }

    // Generic fallback
    return `Review the error and related code. Test: ${testName}`;
  }

  /**
   * Extract code location from stack trace
   */
  private extractCodeLocation(stack?: string): { file: string; line: number } | undefined {
    if (!stack) return undefined;

    // Match patterns like "at ... (file:line:col)" or "at file:line:col"
    const patterns = [
      /at\s+.*?\s+\((.+?):(\d+):\d+\)/,
      /at\s+(.+?):(\d+):\d+/,
    ];

    for (const pattern of patterns) {
      const match = stack.match(pattern);
      if (match) {
        const file = match[1];
        const line = parseInt(match[2], 10);
        // Skip node_modules and internal paths
        if (!file.includes('node_modules') && !file.includes('internal')) {
          return { file, line };
        }
      }
    }

    return undefined;
  }

  /**
   * Generate global suggestions based on failure patterns
   */
  private generateGlobalSuggestions(failedTests: AgentTestResult[]): string[] {
    const suggestions: string[] = [];

    if (failedTests.length === 0) {
      return ['All tests passed!'];
    }

    // Check for common patterns
    const hasTimeouts = failedTests.some(t => 
      t.error?.message?.toLowerCase().includes('timeout')
    );
    const hasConnectionIssues = failedTests.some(t => 
      t.error?.message?.toLowerCase().includes('connection') ||
      t.error?.message?.toLowerCase().includes('cdp')
    );
    const hasElementNotFound = failedTests.some(t =>
      t.error?.message?.toLowerCase().includes('not found') ||
      t.error?.message?.toLowerCase().includes('locator')
    );

    if (!this.electronLaunched) {
      suggestions.push('Electron app may not have launched. Run "pnpm build" first.');
    }

    if (hasTimeouts) {
      suggestions.push('Multiple timeout errors detected. Consider increasing global timeout or adding explicit waits.');
    }

    if (hasConnectionIssues) {
      suggestions.push('Browser connection issues detected. Ensure Chrome is running with --remote-debugging-port=9222');
    }

    if (hasElementNotFound) {
      suggestions.push('Element locator issues detected. Consider adding data-testid attributes to components for reliable selection.');
    }

    // PRD coverage suggestions
    const failedPrdIds = failedTests
      .filter(t => t.prdId)
      .map(t => t.prdId);
    
    if (failedPrdIds.length > 0) {
      suggestions.push(`Failed PRD items: ${failedPrdIds.join(', ')}. Check ACCEPTANCE_CRITERIA.md for requirements.`);
    }

    return suggestions;
  }
}

export default AgentReporter;

