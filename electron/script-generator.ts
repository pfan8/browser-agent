/**
 * Script Generator - Converts DSL recordings to Playwright scripts
 */

import type { 
  Recording, 
  Operation,
  NavigateOperation,
  ClickOperation,
  TypeOperation,
  ScreenshotOperation,
  WaitOperation,
  HoverOperation,
  SelectOperation,
  PressOperation,
  ScrollOperation,
  CheckOperation,
  FocusOperation,
  EvaluateOperation
} from '../dsl/types';

export interface GeneratorOptions {
  language: 'typescript' | 'javascript';
  testFramework: 'playwright-test' | 'playwright';
  includeComments: boolean;
  usePage: boolean;
  baseUrl?: string;
}

const DEFAULT_OPTIONS: GeneratorOptions = {
  language: 'typescript',
  testFramework: 'playwright-test',
  includeComments: true,
  usePage: true
};

export class ScriptGenerator {
  private options: GeneratorOptions;

  constructor(options: Partial<GeneratorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate Playwright script from recording
   */
  generate(recording: Recording): string {
    const lines: string[] = [];
    
    // Add imports
    lines.push(...this.generateImports());
    lines.push('');

    // Add test wrapper or main function
    if (this.options.testFramework === 'playwright-test') {
      lines.push(...this.generateTestWrapper(recording));
    } else {
      lines.push(...this.generateMainFunction(recording));
    }

    return lines.join('\n');
  }

  /**
   * Generate import statements
   */
  private generateImports(): string[] {
    const lines: string[] = [];

    if (this.options.testFramework === 'playwright-test') {
      lines.push("import { test, expect } from '@playwright/test';");
    } else {
      lines.push("import { chromium } from 'playwright';");
    }

    return lines;
  }

  /**
   * Generate test wrapper for playwright-test
   */
  private generateTestWrapper(recording: Recording): string[] {
    const lines: string[] = [];
    const testName = recording.metadata.name || 'Generated Test';
    const description = recording.metadata.description || 'Auto-generated from recording';

    if (this.options.includeComments) {
      lines.push(`/**`);
      lines.push(` * ${description}`);
      lines.push(` * Generated: ${recording.metadata.createdAt}`);
      lines.push(` */`);
    }

    lines.push(`test('${this.escapeString(testName)}', async ({ page }) => {`);
    
    // Generate operations
    for (const operation of recording.operations) {
      const opLines = this.generateOperation(operation, '  ');
      lines.push(...opLines);
    }

    lines.push('});');

    return lines;
  }

  /**
   * Generate main function for standalone script
   */
  private generateMainFunction(recording: Recording): string[] {
    const lines: string[] = [];

    if (this.options.includeComments) {
      lines.push(`/**`);
      lines.push(` * ${recording.metadata.description || 'Auto-generated script'}`);
      lines.push(` * Generated: ${recording.metadata.createdAt}`);
      lines.push(` */`);
    }

    lines.push('async function main() {');
    lines.push('  const browser = await chromium.launch({ headless: false });');
    lines.push('  const context = await browser.newContext();');
    lines.push('  const page = await context.newPage();');
    lines.push('');
    lines.push('  try {');

    // Generate operations
    for (const operation of recording.operations) {
      const opLines = this.generateOperation(operation, '    ');
      lines.push(...opLines);
    }

    lines.push('  } finally {');
    lines.push('    await browser.close();');
    lines.push('  }');
    lines.push('}');
    lines.push('');
    lines.push('main().catch(console.error);');

    return lines;
  }

  /**
   * Generate code for a single operation
   */
  private generateOperation(operation: Operation, indent: string): string[] {
    const lines: string[] = [];

    if (this.options.includeComments && operation.description) {
      lines.push(`${indent}// ${operation.description}`);
    }

    switch (operation.type) {
      case 'navigate':
        lines.push(...this.generateNavigate(operation as NavigateOperation, indent));
        break;
      case 'click':
        lines.push(...this.generateClick(operation as ClickOperation, indent));
        break;
      case 'type':
        lines.push(...this.generateType(operation as TypeOperation, indent));
        break;
      case 'screenshot':
        lines.push(...this.generateScreenshot(operation as ScreenshotOperation, indent));
        break;
      case 'wait':
        lines.push(...this.generateWait(operation as WaitOperation, indent));
        break;
      case 'hover':
        lines.push(...this.generateHover(operation as HoverOperation, indent));
        break;
      case 'select':
        lines.push(...this.generateSelect(operation as SelectOperation, indent));
        break;
      case 'press':
        lines.push(...this.generatePress(operation as PressOperation, indent));
        break;
      case 'scroll':
        lines.push(...this.generateScroll(operation as ScrollOperation, indent));
        break;
      case 'check':
      case 'uncheck':
        lines.push(...this.generateCheck(operation as CheckOperation, indent));
        break;
      case 'focus':
        lines.push(...this.generateFocus(operation as FocusOperation, indent));
        break;
      case 'evaluate':
        lines.push(...this.generateEvaluate(operation as EvaluateOperation, indent));
        break;
      default:
        lines.push(`${indent}// Unknown operation: ${(operation as Operation).type}`);
    }

    lines.push('');
    return lines;
  }

  /**
   * Generate navigate operation
   */
  private generateNavigate(op: NavigateOperation, indent: string): string[] {
    const waitUntil = op.waitUntil ? `, { waitUntil: '${op.waitUntil}' }` : '';
    return [`${indent}await page.goto('${this.escapeString(op.url)}'${waitUntil});`];
  }

  /**
   * Generate click operation
   */
  private generateClick(op: ClickOperation, indent: string): string[] {
    const lines: string[] = [];
    const selector = this.formatSelector(op.selector, op.selectorStrategy);
    
    // Add alternatives as comments
    if (this.options.includeComments && op.alternatives && op.alternatives.length > 0) {
      lines.push(`${indent}// Alternatives: ${op.alternatives.join(', ')}`);
    }

    const options: string[] = [];
    if (op.button && op.button !== 'left') {
      options.push(`button: '${op.button}'`);
    }
    if (op.clickCount && op.clickCount > 1) {
      options.push(`clickCount: ${op.clickCount}`);
    }
    if (op.modifiers && op.modifiers.length > 0) {
      options.push(`modifiers: [${op.modifiers.map(m => `'${m}'`).join(', ')}]`);
    }

    const optionsStr = options.length > 0 ? `, { ${options.join(', ')} }` : '';
    lines.push(`${indent}await page.locator('${this.escapeString(selector)}').click(${optionsStr.slice(2)});`);

    return lines;
  }

  /**
   * Generate type operation
   */
  private generateType(op: TypeOperation, indent: string): string[] {
    const lines: string[] = [];
    const selector = this.formatSelector(op.selector, op.selectorStrategy);

    if (op.clear !== false) {
      lines.push(`${indent}await page.locator('${this.escapeString(selector)}').fill('${this.escapeString(op.text)}');`);
    } else {
      lines.push(`${indent}await page.locator('${this.escapeString(selector)}').type('${this.escapeString(op.text)}');`);
    }

    return lines;
  }

  /**
   * Generate screenshot operation
   */
  private generateScreenshot(op: ScreenshotOperation, indent: string): string[] {
    const options: string[] = [];
    
    if (op.path) {
      options.push(`path: '${this.escapeString(op.path)}'`);
    } else if (op.name) {
      options.push(`path: '${this.escapeString(op.name)}.png'`);
    }
    
    if (op.fullPage) {
      options.push('fullPage: true');
    }

    const optionsStr = options.length > 0 ? `{ ${options.join(', ')} }` : '';
    return [`${indent}await page.screenshot(${optionsStr});`];
  }

  /**
   * Generate wait operation
   */
  private generateWait(op: WaitOperation, indent: string): string[] {
    if (op.selector) {
      const state = op.state ? `, { state: '${op.state}' }` : '';
      return [`${indent}await page.waitForSelector('${this.escapeString(op.selector)}'${state});`];
    }
    
    if (op.url) {
      return [`${indent}await page.waitForURL('${this.escapeString(op.url)}');`];
    }
    
    if (op.duration) {
      return [`${indent}await page.waitForTimeout(${op.duration});`];
    }

    return [`${indent}await page.waitForTimeout(1000);`];
  }

  /**
   * Generate hover operation
   */
  private generateHover(op: HoverOperation, indent: string): string[] {
    const selector = this.formatSelector(op.selector, op.selectorStrategy);
    return [`${indent}await page.locator('${this.escapeString(selector)}').hover();`];
  }

  /**
   * Generate select operation
   */
  private generateSelect(op: SelectOperation, indent: string): string[] {
    const selector = this.formatSelector(op.selector, op.selectorStrategy);
    
    if (op.label) {
      return [`${indent}await page.locator('${this.escapeString(selector)}').selectOption({ label: '${this.escapeString(op.label)}' });`];
    }
    if (op.index !== undefined) {
      return [`${indent}await page.locator('${this.escapeString(selector)}').selectOption({ index: ${op.index} });`];
    }
    
    return [`${indent}await page.locator('${this.escapeString(selector)}').selectOption('${this.escapeString(op.value || '')}');`];
  }

  /**
   * Generate press operation
   */
  private generatePress(op: PressOperation, indent: string): string[] {
    if (op.selector) {
      return [`${indent}await page.locator('${this.escapeString(op.selector)}').press('${op.key}');`];
    }
    return [`${indent}await page.keyboard.press('${op.key}');`];
  }

  /**
   * Generate scroll operation
   */
  private generateScroll(op: ScrollOperation, indent: string): string[] {
    if (op.selector) {
      return [`${indent}await page.locator('${this.escapeString(op.selector)}').scrollIntoViewIfNeeded();`];
    }
    
    const x = op.x || 0;
    const y = op.y || 0;
    return [`${indent}await page.evaluate(() => window.scrollBy(${x}, ${y}));`];
  }

  /**
   * Generate check/uncheck operation
   */
  private generateCheck(op: CheckOperation, indent: string): string[] {
    const selector = this.formatSelector(op.selector, op.selectorStrategy);
    const method = op.type === 'check' ? 'check' : 'uncheck';
    return [`${indent}await page.locator('${this.escapeString(selector)}').${method}();`];
  }

  /**
   * Generate focus operation
   */
  private generateFocus(op: FocusOperation, indent: string): string[] {
    const selector = this.formatSelector(op.selector, op.selectorStrategy);
    return [`${indent}await page.locator('${this.escapeString(selector)}').focus();`];
  }

  /**
   * Generate evaluate operation
   */
  private generateEvaluate(op: EvaluateOperation, indent: string): string[] {
    const args = op.args ? `, ${JSON.stringify(op.args)}` : '';
    return [`${indent}await page.evaluate(${op.script}${args});`];
  }

  /**
   * Format selector based on strategy
   */
  private formatSelector(selector: string, strategy: string): string {
    switch (strategy) {
      case 'text':
        return `text=${selector}`;
      case 'role':
        return selector; // Already formatted as role=xxx
      case 'testid':
        return `[data-testid="${selector}"]`;
      case 'label':
        return `label=${selector}`;
      case 'placeholder':
        return `[placeholder="${selector}"]`;
      case 'xpath':
        return `xpath=${selector}`;
      case 'css':
      default:
        return selector;
    }
  }

  /**
   * Escape string for JavaScript
   */
  private escapeString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Generate a summary of the recording
   */
  generateSummary(recording: Recording): string {
    const lines: string[] = [];
    
    lines.push(`Recording: ${recording.metadata.name || 'Unnamed'}`);
    lines.push(`Created: ${recording.metadata.createdAt}`);
    lines.push(`Operations: ${recording.operations.length}`);
    lines.push('');
    lines.push('Steps:');

    for (let i = 0; i < recording.operations.length; i++) {
      const op = recording.operations[i];
      lines.push(`  ${i + 1}. ${this.describeOperation(op)}`);
    }

    return lines.join('\n');
  }

  /**
   * Describe an operation in human-readable form
   */
  private describeOperation(op: Operation): string {
    switch (op.type) {
      case 'navigate':
        return `Navigate to ${(op as NavigateOperation).url}`;
      case 'click':
        return `Click on ${(op as ClickOperation).selector}`;
      case 'type':
        return `Type "${(op as TypeOperation).text}" into ${(op as TypeOperation).selector}`;
      case 'screenshot':
        return `Take screenshot${(op as ScreenshotOperation).name ? ` (${(op as ScreenshotOperation).name})` : ''}`;
      case 'wait':
        const waitOp = op as WaitOperation;
        if (waitOp.selector) return `Wait for ${waitOp.selector}`;
        return `Wait ${waitOp.duration}ms`;
      case 'hover':
        return `Hover over ${(op as HoverOperation).selector}`;
      case 'select':
        return `Select ${(op as SelectOperation).value} from ${(op as SelectOperation).selector}`;
      case 'press':
        return `Press ${(op as PressOperation).key}`;
      default:
        return `${op.type} operation`;
    }
  }
}

// Export singleton instance with default options
export const scriptGenerator = new ScriptGenerator();

// Export function for quick generation
export function generatePlaywrightScript(recording: Recording, options?: Partial<GeneratorOptions>): string {
  const generator = new ScriptGenerator(options);
  return generator.generate(recording);
}

