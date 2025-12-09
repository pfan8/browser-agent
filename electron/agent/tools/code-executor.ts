/**
 * CodeAct Executor
 * 
 * Executes code in a sandboxed environment using vm2.
 * Provides utilities for DOM parsing, data processing, and selector generation.
 * 
 * This is the CodeAct component that complements ReAct for complex tasks.
 */

import { VM, VMScript } from 'vm2';
import * as cheerio from 'cheerio';
import _ from 'lodash';
import type {
  CodeActRequest,
  CodeActResult,
  ElementInfo,
} from '../types';

// ============================================
// Sandbox Configuration
// ============================================

const DEFAULT_TIMEOUT = 10000; // 10 seconds
const MAX_OUTPUT_SIZE = 100000; // 100KB max output

// ============================================
// Sandbox API Implementation
// ============================================

/**
 * Create sandbox API available to executed code
 */
function createSandboxAPI() {
  return {
    // ==========================================
    // DOM Utilities (using cheerio)
    // ==========================================
    
    /**
     * Parse HTML string and return cheerio instance
     */
    parseHTML: (html: string) => {
      return cheerio.load(html);
    },
    
    /**
     * Query elements from HTML using CSS selector
     */
    querySelectorAll: (html: string, selector: string): unknown[] => {
      const $ = cheerio.load(html);
      const results: unknown[] = [];
      
      $(selector).each((_, el) => {
        const $el = $(el);
        // Use any to handle cheerio's complex typing
        const element = el as { tagName?: string; name?: string; attribs?: Record<string, string> };
        results.push({
          tag: element.tagName || element.name || 'unknown',
          text: $el.text().trim().slice(0, 200),
          html: $.html(el).slice(0, 500),
          attributes: element.attribs || {},
        });
      });
      
      return results;
    },
    
    /**
     * Extract all text content from HTML
     */
    extractText: (html: string): string => {
      const $ = cheerio.load(html);
      return $('body').text().trim();
    },
    
    /**
     * Get all links from HTML
     */
    extractLinks: (html: string): Array<{ href: string; text: string }> => {
      const $ = cheerio.load(html);
      const links: Array<{ href: string; text: string }> = [];
      
      $('a[href]').each((_, el) => {
        const $el = $(el);
        links.push({
          href: $el.attr('href') || '',
          text: $el.text().trim(),
        });
      });
      
      return links;
    },
    
    /**
     * Get all form inputs from HTML
     */
    extractInputs: (html: string): Array<{
      type: string;
      name: string;
      id: string;
      placeholder: string;
      selector: string;
    }> => {
      const $ = cheerio.load(html);
      const inputs: Array<{
        type: string;
        name: string;
        id: string;
        placeholder: string;
        selector: string;
      }> = [];
      
      $('input, textarea, select').each((_, el) => {
        const $el = $(el);
        const id = $el.attr('id') || '';
        const name = $el.attr('name') || '';
        
        let selector = el.tagName;
        if (id) selector = `#${id}`;
        else if (name) selector = `${el.tagName}[name="${name}"]`;
        
        inputs.push({
          type: $el.attr('type') || el.tagName,
          name,
          id,
          placeholder: $el.attr('placeholder') || '',
          selector,
        });
      });
      
      return inputs;
    },
    
    /**
     * Get all buttons from HTML
     */
    extractButtons: (html: string): Array<{
      text: string;
      type: string;
      selector: string;
    }> => {
      const $ = cheerio.load(html);
      const buttons: Array<{
        text: string;
        type: string;
        selector: string;
      }> = [];
      
      $('button, input[type="submit"], input[type="button"], [role="button"]').each((_, el) => {
        const $el = $(el);
        const text = $el.text().trim() || $el.attr('value') || '';
        const id = $el.attr('id');
        const testId = $el.attr('data-testid');
        
        let selector = '';
        if (id) selector = `#${id}`;
        else if (testId) selector = `[data-testid="${testId}"]`;
        else if (text) selector = `${el.tagName}:has-text("${text.slice(0, 50)}")`;
        else selector = el.tagName;
        
        buttons.push({
          text,
          type: $el.attr('type') || 'button',
          selector,
        });
      });
      
      return buttons;
    },
    
    // ==========================================
    // Data Utilities (using lodash)
    // ==========================================
    
    /**
     * Sort array by key
     */
    sortBy: <T>(arr: T[], key: string): T[] => {
      return _.sortBy(arr, key);
    },
    
    /**
     * Sort array by key in descending order
     */
    sortByDesc: <T>(arr: T[], key: string): T[] => {
      return _.orderBy(arr, key, 'desc');
    },
    
    /**
     * Filter array by predicate
     */
    filterBy: <T>(arr: T[], predicate: string | ((item: T) => boolean)): T[] => {
      if (typeof predicate === 'string') {
        // Simple key existence filter
        return arr.filter(item => _.get(item, predicate) !== undefined);
      }
      return arr.filter(predicate);
    },
    
    /**
     * Group array by key
     */
    groupBy: <T>(arr: T[], key: string): Record<string, T[]> => {
      return _.groupBy(arr, key);
    },
    
    /**
     * Find item by predicate
     */
    find: <T>(arr: T[], predicate: Partial<T>): T | undefined => {
      return _.find(arr, predicate) as T | undefined;
    },
    
    /**
     * Pick specific keys from object
     */
    pick: <T extends object>(obj: T, keys: string[]): Partial<T> => {
      return _.pick(obj, keys);
    },
    
    /**
     * Unique values in array
     */
    unique: <T>(arr: T[]): T[] => {
      return _.uniq(arr);
    },
    
    /**
     * Unique by key
     */
    uniqueBy: <T>(arr: T[], key: string): T[] => {
      return _.uniqBy(arr, key);
    },
    
    // ==========================================
    // String Utilities
    // ==========================================
    
    /**
     * Calculate Levenshtein distance between two strings
     */
    levenshteinDistance: (str1: string, str2: string): number => {
      const m = str1.length;
      const n = str2.length;
      const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
      
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (str1[i - 1] === str2[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1];
          } else {
            dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
          }
        }
      }
      
      return dp[m][n];
    },
    
    /**
     * Calculate similarity score (0-1) between two strings
     */
    similarity: (str1: string, str2: string): number => {
      const s1 = str1.toLowerCase();
      const s2 = str2.toLowerCase();
      
      if (s1 === s2) return 1;
      if (s1.length === 0 || s2.length === 0) return 0;
      
      const maxLen = Math.max(s1.length, s2.length);
      const distance = levenshteinDistance(s1, s2);
      return 1 - (distance / maxLen);
    },
    
    /**
     * Check if string contains pattern (case-insensitive)
     */
    contains: (str: string, pattern: string): boolean => {
      return str.toLowerCase().includes(pattern.toLowerCase());
    },
    
    /**
     * Fuzzy match - check if all characters of pattern exist in str in order
     */
    fuzzyMatch: (str: string, pattern: string): boolean => {
      const s = str.toLowerCase();
      const p = pattern.toLowerCase();
      let j = 0;
      
      for (let i = 0; i < s.length && j < p.length; i++) {
        if (s[i] === p[j]) j++;
      }
      
      return j === p.length;
    },
    
    // ==========================================
    // Selector Generation
    // ==========================================
    
    /**
     * Generate best CSS selector for an element
     */
    generateSelector: (element: ElementInfo): string => {
      const attrs = element.attributes;
      
      // Priority: id > data-testid > name > class+text > tag+text
      if (attrs.id) {
        return `#${attrs.id}`;
      }
      
      if (attrs['data-testid']) {
        return `[data-testid="${attrs['data-testid']}"]`;
      }
      
      if (attrs.name) {
        return `${element.tag}[name="${attrs.name}"]`;
      }
      
      if (element.text) {
        const cleanText = element.text.slice(0, 30).replace(/"/g, '\\"');
        return `${element.tag}:has-text("${cleanText}")`;
      }
      
      if (attrs.class) {
        const primaryClass = attrs.class.split(' ')[0];
        return `${element.tag}.${primaryClass}`;
      }
      
      return element.tag;
    },
    
    /**
     * Find best matching element from list by description
     */
    findBestMatch: (elements: ElementInfo[], description: string): ElementInfo | null => {
      if (elements.length === 0) return null;
      
      let bestMatch: ElementInfo | null = null;
      let bestScore = 0;
      
      const descLower = description.toLowerCase();
      
      for (const el of elements) {
        let score = 0;
        
        // Check text content
        if (el.text) {
          const textLower = el.text.toLowerCase();
          if (textLower === descLower) {
            score += 100;
          } else if (textLower.includes(descLower)) {
            score += 50;
          } else {
            score += similarity(textLower, descLower) * 30;
          }
        }
        
        // Check attributes
        const attrs = el.attributes;
        if (attrs['aria-label']?.toLowerCase().includes(descLower)) {
          score += 40;
        }
        if (attrs.placeholder?.toLowerCase().includes(descLower)) {
          score += 35;
        }
        if (attrs.title?.toLowerCase().includes(descLower)) {
          score += 30;
        }
        if (attrs.name?.toLowerCase().includes(descLower)) {
          score += 25;
        }
        if (attrs.id?.toLowerCase().includes(descLower)) {
          score += 20;
        }
        
        // Prefer interactable elements
        if (el.isInteractable) {
          score += 10;
        }
        
        // Prefer visible elements
        if (el.isVisible) {
          score += 5;
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = el;
        }
      }
      
      return bestMatch;
    },
    
    /**
     * Generate multiple selector strategies for an element
     */
    generateSelectorStrategies: (element: ElementInfo): string[] => {
      const selectors: string[] = [];
      const attrs = element.attributes;
      
      if (attrs.id) {
        selectors.push(`#${attrs.id}`);
      }
      
      if (attrs['data-testid']) {
        selectors.push(`[data-testid="${attrs['data-testid']}"]`);
      }
      
      if (attrs.name) {
        selectors.push(`${element.tag}[name="${attrs.name}"]`);
      }
      
      if (attrs['aria-label']) {
        selectors.push(`${element.tag}[aria-label="${attrs['aria-label']}"]`);
      }
      
      if (element.text) {
        const cleanText = element.text.slice(0, 50).replace(/"/g, '\\"');
        selectors.push(`${element.tag}:has-text("${cleanText}")`);
        selectors.push(`text="${cleanText}"`);
      }
      
      if (attrs.class) {
        const classes = attrs.class.split(' ').filter(c => c.length > 0);
        if (classes.length > 0) {
          selectors.push(`${element.tag}.${classes[0]}`);
          if (classes.length > 1) {
            selectors.push(`${element.tag}.${classes.join('.')}`);
          }
        }
      }
      
      return selectors;
    },
    
    // ==========================================
    // Utility Functions
    // ==========================================
    
    /**
     * Parse JSON safely
     */
    parseJSON: (str: string): unknown | null => {
      try {
        return JSON.parse(str);
      } catch {
        return null;
      }
    },
    
    /**
     * Stringify to JSON
     */
    toJSON: (obj: unknown): string => {
      return JSON.stringify(obj, null, 2);
    },
    
    /**
     * Log output (captured by sandbox)
     */
    log: (...args: unknown[]) => {
      console.log('[CodeAct]', ...args);
    },
  };
}

// Helper for similarity function
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  
  return dp[m][n];
}

function similarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  const maxLen = Math.max(s1.length, s2.length);
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

// ============================================
// Code Executor Class
// ============================================

export class CodeExecutor {
  private timeout: number;
  private outputBuffer: string[] = [];
  
  constructor(timeout: number = DEFAULT_TIMEOUT) {
    this.timeout = timeout;
  }
  
  /**
   * Execute code in sandbox
   */
  async execute(request: CodeActRequest): Promise<CodeActResult> {
    const startTime = Date.now();
    this.outputBuffer = [];
    
    const timeout = request.timeout || this.timeout;
    
    try {
      // Create sandbox API
      const sandboxAPI = createSandboxAPI();
      
      // Create VM with sandbox
      const vm = new VM({
        timeout,
        sandbox: {
          ...sandboxAPI,
          // Inject context if provided
          context: request.context || {},
          // Capture console output
          console: {
            log: (...args: unknown[]) => {
              const output = args.map(a => 
                typeof a === 'object' ? JSON.stringify(a) : String(a)
              ).join(' ');
              this.outputBuffer.push(output);
              if (this.outputBuffer.join('\n').length > MAX_OUTPUT_SIZE) {
                throw new Error('Output size limit exceeded');
              }
            },
            error: (...args: unknown[]) => {
              this.outputBuffer.push('[ERROR] ' + args.map(a => String(a)).join(' '));
            },
            warn: (...args: unknown[]) => {
              this.outputBuffer.push('[WARN] ' + args.map(a => String(a)).join(' '));
            },
          },
          // Provide limited JSON API
          JSON: {
            parse: JSON.parse,
            stringify: JSON.stringify,
          },
          // Provide Math
          Math,
          // Provide Date
          Date,
          // Provide Array utilities
          Array,
          Object,
          String,
          Number,
          Boolean,
          RegExp,
        },
      });
      
      // Wrap code in IIFE if it contains return statements
      let codeToRun = request.code;
      if (codeToRun.includes('return ')) {
        codeToRun = `(function() { ${codeToRun} })()`;
      }
      
      // Compile and run the code
      const script = new VMScript(codeToRun);
      const result = vm.run(script);
      
      return {
        success: true,
        result,
        stdout: this.outputBuffer.join('\n'),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stderr: error instanceof Error ? error.stack : undefined,
        stdout: this.outputBuffer.join('\n'),
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Execute code for DOM parsing task
   */
  async parseDOM(html: string, task: string): Promise<CodeActResult> {
    const code = `
      const $ = parseHTML(context.html);
      const task = context.task;
      
      // Common DOM parsing tasks
      if (task.includes('button') || task.includes('按钮')) {
        return extractButtons(context.html);
      }
      
      if (task.includes('link') || task.includes('链接')) {
        return extractLinks(context.html);
      }
      
      if (task.includes('input') || task.includes('输入框') || task.includes('form') || task.includes('表单')) {
        return extractInputs(context.html);
      }
      
      if (task.includes('text') || task.includes('文本')) {
        return extractText(context.html);
      }
      
      // Default: return basic structure
      return {
        buttons: extractButtons(context.html),
        links: extractLinks(context.html),
        inputs: extractInputs(context.html),
      };
    `;
    
    return this.execute({
      code,
      language: 'javascript',
      context: { html, task },
    });
  }
  
  /**
   * Execute code for finding best element match
   */
  async findElement(elements: ElementInfo[], description: string): Promise<CodeActResult> {
    const code = `
      const elements = context.elements;
      const description = context.description;
      
      const match = findBestMatch(elements, description);
      
      if (match) {
        return {
          found: true,
          element: match,
          selector: generateSelector(match),
          allStrategies: generateSelectorStrategies(match),
        };
      }
      
      return {
        found: false,
        suggestion: 'No matching element found. Try a different description.',
      };
    `;
    
    return this.execute({
      code,
      language: 'javascript',
      context: { elements, description },
    });
  }
  
  /**
   * Execute code for data extraction
   */
  async extractData(html: string, selector: string): Promise<CodeActResult> {
    const code = `
      const results = querySelectorAll(context.html, context.selector);
      return {
        count: results.length,
        items: results.slice(0, 50),  // Limit to 50 items
      };
    `;
    
    return this.execute({
      code,
      language: 'javascript',
      context: { html, selector },
    });
  }
  
  /**
   * Execute code for sorting/filtering data
   */
  async processData(
    data: unknown[],
    operation: 'sort' | 'filter' | 'group',
    key: string,
    direction?: 'asc' | 'desc'
  ): Promise<CodeActResult> {
    const code = `
      const data = context.data;
      const operation = context.operation;
      const key = context.key;
      const direction = context.direction;
      
      switch (operation) {
        case 'sort':
          return direction === 'desc' 
            ? sortByDesc(data, key) 
            : sortBy(data, key);
        case 'filter':
          return filterBy(data, key);
        case 'group':
          return groupBy(data, key);
        default:
          return data;
      }
    `;
    
    return this.execute({
      code,
      language: 'javascript',
      context: { data, operation, key, direction },
    });
  }
  
  /**
   * Update timeout setting
   */
  setTimeout(timeout: number): void {
    this.timeout = timeout;
  }
}

// Export singleton instance
export const codeExecutor = new CodeExecutor();

// Export create function for custom instances
export function createCodeExecutor(timeout?: number): CodeExecutor {
  return new CodeExecutor(timeout);
}

