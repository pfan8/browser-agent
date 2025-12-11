#!/usr/bin/env tsx
/**
 * PRD Verification Script
 * 
 * Parses E2E test results and generates a PRD verification report.
 * Maps test results to PRD requirement IDs (BC-01, BO-02, etc.)
 * 
 * Usage:
 *   pnpm verify:prd
 * 
 * Prerequisites:
 *   Run E2E tests first: pnpm test:e2e
 */

import * as fs from 'fs';
import * as path from 'path';

// Types
interface AgentTestResult {
  name: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  duration: number;
  prdId?: string;
  error?: {
    message: string;
    suggestedFix: string;
  };
}

interface AgentReport {
  timestamp: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  tests: AgentTestResult[];
}

interface PRDItem {
  id: string;
  description: string;
  category: string;
  status: 'passed' | 'failed' | 'skipped' | 'not_tested';
  testName?: string;
  error?: string;
  suggestedFix?: string;
}

interface PRDCategory {
  name: string;
  items: PRDItem[];
  passed: number;
  failed: number;
  total: number;
}

interface PRDVerificationReport {
  timestamp: string;
  summary: {
    totalPRD: number;
    passed: number;
    failed: number;
    skipped: number;
    notTested: number;
    coverage: string;
  };
  categories: PRDCategory[];
  failedItems: PRDItem[];
}

// PRD Categories and IDs
const PRD_DEFINITIONS: Record<string, { name: string; items: string[] }> = {
  BC: {
    name: 'Browser Connection',
    items: ['BC-01', 'BC-02', 'BC-03', 'BC-04', 'BC-05', 'BC-06'],
  },
  BO: {
    name: 'Browser Operations',
    items: ['BO-01', 'BO-02', 'BO-03', 'BO-04', 'BO-05', 'BO-06', 'BO-07', 'BO-08', 'BO-09', 'BO-10'],
  },
  RA: {
    name: 'ReAct Agent',
    items: ['RA-01', 'RA-02', 'RA-03', 'RA-04', 'RA-05', 'RA-06', 'RA-07', 'RA-08'],
  },
  CA: {
    name: 'CodeAct',
    items: ['CA-01', 'CA-02', 'CA-03', 'CA-04', 'CA-05', 'CA-06'],
  },
  SC: {
    name: 'Session & Checkpoint',
    items: ['SC-01', 'SC-02', 'SC-03', 'SC-04', 'SC-05', 'SC-06', 'SC-07', 'SC-08'],
  },
  RS: {
    name: 'Recording & Export',
    items: ['RS-01', 'RS-02', 'RS-03', 'RS-04', 'RS-05'],
  },
  LM: {
    name: 'LLM Integration',
    items: ['LM-01', 'LM-02', 'LM-03', 'LM-04', 'LM-05'],
  },
  UI: {
    name: 'User Interface',
    items: ['UI-01', 'UI-02', 'UI-03', 'UI-04', 'UI-05', 'UI-06', 'UI-07', 'UI-08'],
  },
};

// Paths
const projectRoot = path.join(__dirname, '..');
const reportPath = path.join(projectRoot, 'test-results', 'agent-report.json');
const prdReportPath = path.join(projectRoot, 'test-results', 'prd-verification.json');

function verifyPRD(): PRDVerificationReport {
  console.log('═'.repeat(60));
  console.log('  PRD Verification Report');
  console.log('═'.repeat(60));
  console.log('');

  // Check if report exists
  if (!fs.existsSync(reportPath)) {
    console.error('❌ Error: Test report not found at:', reportPath);
    console.error('   Run E2E tests first: pnpm test:e2e');
    
    // Return empty report
    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalPRD: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        notTested: 0,
        coverage: '0%',
      },
      categories: [],
      failedItems: [],
    };
  }

  // Read test report
  const report: AgentReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  console.log(`📊 Found ${report.tests.length} test results`);
  console.log('');

  // Build test result map by PRD ID
  const testResultMap = new Map<string, AgentTestResult>();
  for (const test of report.tests) {
    // Extract PRD ID from test name (e.g., "BC-01: should connect via CDP")
    const prdMatch = test.name.match(/^([A-Z]+-\d+):/);
    if (prdMatch) {
      testResultMap.set(prdMatch[1], test);
    }
  }

  // Build PRD verification report
  const categories: PRDCategory[] = [];
  const failedItems: PRDItem[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalNotTested = 0;

  for (const [prefix, def] of Object.entries(PRD_DEFINITIONS)) {
    const category: PRDCategory = {
      name: def.name,
      items: [],
      passed: 0,
      failed: 0,
      total: def.items.length,
    };

    for (const prdId of def.items) {
      const testResult = testResultMap.get(prdId);
      
      let item: PRDItem;
      
      if (!testResult) {
        item = {
          id: prdId,
          description: `${prdId} test not found`,
          category: def.name,
          status: 'not_tested',
        };
        totalNotTested++;
      } else {
        const status = testResult.status === 'passed' ? 'passed' :
                      testResult.status === 'skipped' ? 'skipped' : 'failed';
        
        item = {
          id: prdId,
          description: testResult.name,
          category: def.name,
          status,
          testName: testResult.name,
          error: testResult.error?.message,
          suggestedFix: testResult.error?.suggestedFix,
        };

        if (status === 'passed') {
          totalPassed++;
          category.passed++;
        } else if (status === 'failed') {
          totalFailed++;
          category.failed++;
          failedItems.push(item);
        } else {
          totalSkipped++;
        }
      }

      category.items.push(item);
    }

    categories.push(category);
  }

  const totalPRD = Object.values(PRD_DEFINITIONS).reduce((sum, def) => sum + def.items.length, 0);
  const coverage = totalPRD > 0 
    ? `${((totalPassed / totalPRD) * 100).toFixed(1)}%`
    : '0%';

  const verificationReport: PRDVerificationReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalPRD,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalSkipped,
      notTested: totalNotTested,
      coverage,
    },
    categories,
    failedItems,
  };

  // Print report
  console.log('📋 PRD Coverage Summary');
  console.log('-'.repeat(40));
  console.log(`Total PRD Items: ${totalPRD}`);
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`⏭️  Skipped: ${totalSkipped}`);
  console.log(`❓ Not Tested: ${totalNotTested}`);
  console.log(`📈 Coverage: ${coverage}`);
  console.log('');

  // Print by category
  console.log('📂 By Category:');
  console.log('-'.repeat(40));
  for (const cat of categories) {
    const catStatus = cat.failed === 0 ? '✅' : '❌';
    console.log(`${catStatus} ${cat.name}: ${cat.passed}/${cat.total} passed`);
  }
  console.log('');

  // Print failed items
  if (failedItems.length > 0) {
    console.log('❌ Failed PRD Items:');
    console.log('-'.repeat(40));
    for (const item of failedItems) {
      console.log(`  ${item.id}: ${item.description}`);
      if (item.error) {
        console.log(`    Error: ${item.error}`);
      }
      if (item.suggestedFix) {
        console.log(`    Fix: ${item.suggestedFix}`);
      }
    }
    console.log('');
  }

  // Save report
  fs.mkdirSync(path.dirname(prdReportPath), { recursive: true });
  fs.writeFileSync(prdReportPath, JSON.stringify(verificationReport, null, 2));
  console.log(`💾 Report saved to: ${prdReportPath}`);
  console.log('');

  // Output structured data for agent
  console.log('===== PRD_VERIFICATION_START =====');
  console.log(JSON.stringify({
    coverage,
    passed: totalPassed,
    failed: totalFailed,
    totalPRD,
    failedItems: failedItems.map(item => ({
      id: item.id,
      category: item.category,
      error: item.error,
      suggestedFix: item.suggestedFix,
    })),
    categories: categories.map(cat => ({
      name: cat.name,
      passed: cat.passed,
      failed: cat.failed,
      total: cat.total,
    })),
  }, null, 2));
  console.log('===== PRD_VERIFICATION_END =====');

  return verificationReport;
}

// Run
const report = verifyPRD();

console.log('');
console.log('═'.repeat(60));
console.log(`  PRD Verification Complete - Coverage: ${report.summary.coverage}`);
console.log('═'.repeat(60));

process.exit(report.summary.failed > 0 ? 1 : 0);

