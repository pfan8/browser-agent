/**
 * State Awareness Module
 * 
 * Provides page state detection and verification capabilities:
 * - SA-01: Page load detection (DOM ready + key elements)
 * - SA-02: Operation result verification
 * - SA-03: Goal completion judgment
 * - SA-04: Intermediate state recognition (loading/modal)
 * - SA-05: Context preservation (goal memory)
 * - SA-06: Dynamic content detection (AJAX updates)
 */

import type { Observation, ElementInfo } from './types';
import { browserController } from '../browser-controller';

// ============================================
// Types
// ============================================

export interface PageState {
  url: string;
  title: string;
  isLoading: boolean;
  hasModalOverlay: boolean;
  hasLoadingIndicator: boolean;
  visibleElementCount: number;
  domHash: string;
  timestamp: string;
}

export interface StateChangeResult {
  changed: boolean;
  changes: StateChange[];
  previousState: PageState | null;
  currentState: PageState;
}

export interface StateChange {
  type: 'url' | 'title' | 'dom' | 'loading' | 'modal' | 'elements';
  before: unknown;
  after: unknown;
  description: string;
}

export interface VerificationResult {
  success: boolean;
  verified: boolean;
  details: string;
  confidence: number;
}

export interface GoalContext {
  originalGoal: string;
  subGoals: string[];
  completedSteps: string[];
  currentStep: string;
  startTime: string;
  lastUpdateTime: string;
}

// ============================================
// Loading Indicators
// ============================================

const LOADING_INDICATORS = {
  selectors: [
    '.loading',
    '.spinner',
    '.loader',
    '[class*="loading"]',
    '[class*="spinner"]',
    '[class*="loader"]',
    '.sk-spinner',
    '.sk-loading',
    '[aria-busy="true"]',
    '[data-loading="true"]',
    '.MuiCircularProgress-root',
    '.ant-spin',
    '.el-loading',
  ],
  texts: [
    'Loading...',
    'Please wait',
    '加载中',
    '请稍候',
    '正在加载',
  ],
};

const MODAL_SELECTORS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '.modal',
  '.dialog',
  '[class*="modal"]',
  '[class*="dialog"]',
  '[class*="overlay"]',
  '.MuiDialog-root',
  '.ant-modal',
  '.el-dialog',
  '[aria-modal="true"]',
];

// ============================================
// State Awareness Class
// ============================================

export class StateAwareness {
  private previousState: PageState | null = null;
  private goalContext: GoalContext | null = null;
  private stateHistory: PageState[] = [];
  private maxHistorySize: number = 10;

  /**
   * SA-01: Check if page is fully loaded
   */
  async isPageLoaded(): Promise<{ loaded: boolean; details: string }> {
    const page = browserController.getPage();
    if (!page) {
      return { loaded: false, details: 'Browser not connected' };
    }

    try {
      // Check document ready state
      const readyState = await page.evaluate(() => document.readyState);
      
      if (readyState !== 'complete') {
        return { loaded: false, details: `Document state: ${readyState}` };
      }

      // Check for loading indicators
      const hasLoading = await this.hasLoadingIndicator();
      if (hasLoading) {
        return { loaded: false, details: 'Loading indicator detected' };
      }

      // Check if main content is visible
      const hasContent = await page.evaluate(() => {
        const body = document.body;
        if (!body) return false;
        
        // Check for visible content
        const textLength = body.innerText?.trim().length || 0;
        const elementCount = document.querySelectorAll('*').length;
        
        return textLength > 50 || elementCount > 10;
      });

      if (!hasContent) {
        return { loaded: false, details: 'Page appears empty' };
      }

      return { loaded: true, details: 'Page fully loaded' };
    } catch (error) {
      return { loaded: false, details: `Error checking load state: ${error}` };
    }
  }

  /**
   * SA-01: Wait for page to be fully loaded
   */
  async waitForPageLoad(timeout: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const { loaded } = await this.isPageLoaded();
      if (loaded) return true;
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return false;
  }

  /**
   * SA-02: Verify operation result
   */
  async verifyOperation(
    operationType: string,
    expectedResult: Record<string, unknown>
  ): Promise<VerificationResult> {
    const page = browserController.getPage();
    if (!page) {
      return {
        success: false,
        verified: false,
        details: 'Browser not connected',
        confidence: 0,
      };
    }

    try {
      switch (operationType) {
        case 'type':
        case 'input':
          return this.verifyInputValue(
            expectedResult.selector as string,
            expectedResult.text as string
          );

        case 'click':
          return this.verifyClickResult(expectedResult);

        case 'navigate':
          return this.verifyNavigation(expectedResult.url as string);

        case 'select':
          return this.verifySelectValue(
            expectedResult.selector as string,
            expectedResult.value as string
          );

        default:
          // Generic verification - check if page changed
          const stateChange = await this.detectStateChange();
          return {
            success: true,
            verified: stateChange.changed,
            details: stateChange.changed 
              ? `State changed: ${stateChange.changes.map(c => c.description).join(', ')}`
              : 'No detectable state change',
            confidence: stateChange.changed ? 0.7 : 0.3,
          };
      }
    } catch (error) {
      return {
        success: false,
        verified: false,
        details: `Verification error: ${error}`,
        confidence: 0,
      };
    }
  }

  /**
   * Verify input value after typing
   */
  private async verifyInputValue(selector: string, expectedText: string): Promise<VerificationResult> {
    const page = browserController.getPage();
    if (!page) {
      return { success: false, verified: false, details: 'No page', confidence: 0 };
    }

    try {
      const actualValue = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLInputElement;
        return el?.value || '';
      }, selector);

      const verified = actualValue === expectedText;
      
      return {
        success: true,
        verified,
        details: verified 
          ? 'Input value matches expected'
          : `Expected "${expectedText}", got "${actualValue}"`,
        confidence: verified ? 1.0 : 0.0,
      };
    } catch {
      return {
        success: false,
        verified: false,
        details: 'Could not verify input value',
        confidence: 0,
      };
    }
  }

  /**
   * Verify click result
   */
  private async verifyClickResult(expected: Record<string, unknown>): Promise<VerificationResult> {
    // Check if URL changed (for navigation clicks)
    if (expected.expectNavigation) {
      const currentUrl = browserController.getPage()?.url();
      const urlChanged = currentUrl !== expected.previousUrl;
      
      return {
        success: true,
        verified: urlChanged,
        details: urlChanged ? 'Navigation occurred' : 'URL unchanged',
        confidence: urlChanged ? 0.9 : 0.5,
      };
    }

    // Check for state changes
    const stateChange = await this.detectStateChange();
    
    return {
      success: true,
      verified: stateChange.changed,
      details: stateChange.changed
        ? `Click caused changes: ${stateChange.changes.map(c => c.description).join(', ')}`
        : 'No visible changes after click',
      confidence: stateChange.changed ? 0.8 : 0.4,
    };
  }

  /**
   * Verify navigation
   */
  private async verifyNavigation(expectedUrl: string): Promise<VerificationResult> {
    const page = browserController.getPage();
    if (!page) {
      return { success: false, verified: false, details: 'No page', confidence: 0 };
    }

    const currentUrl = page.url();
    
    // Check if URL matches or contains expected
    const matches = currentUrl === expectedUrl || 
                   currentUrl.includes(expectedUrl.replace(/^https?:\/\//, ''));
    
    return {
      success: true,
      verified: matches,
      details: matches 
        ? `Navigated to ${currentUrl}`
        : `Expected ${expectedUrl}, at ${currentUrl}`,
      confidence: matches ? 1.0 : 0.2,
    };
  }

  /**
   * Verify select value
   */
  private async verifySelectValue(selector: string, expectedValue: string): Promise<VerificationResult> {
    const page = browserController.getPage();
    if (!page) {
      return { success: false, verified: false, details: 'No page', confidence: 0 };
    }

    try {
      const actualValue = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLSelectElement;
        return el?.value || '';
      }, selector);

      const verified = actualValue === expectedValue;
      
      return {
        success: true,
        verified,
        details: verified 
          ? 'Select value matches'
          : `Expected "${expectedValue}", got "${actualValue}"`,
        confidence: verified ? 1.0 : 0.0,
      };
    } catch {
      return {
        success: false,
        verified: false,
        details: 'Could not verify select value',
        confidence: 0,
      };
    }
  }

  /**
   * SA-03: Check if goal is completed
   */
  async isGoalCompleted(goal: string, observation: Observation): Promise<{
    completed: boolean;
    confidence: number;
    reason: string;
  }> {
    // Analyze goal type
    const goalLower = goal.toLowerCase();
    
    // Navigation goals
    if (goalLower.includes('导航') || goalLower.includes('打开') || 
        goalLower.includes('navigate') || goalLower.includes('go to') ||
        goalLower.includes('open')) {
      const urlMatch = goal.match(/https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (urlMatch) {
        const targetUrl = urlMatch[0];
        const currentUrl = observation.url.toLowerCase();
        const completed = currentUrl.includes(targetUrl.toLowerCase().replace(/^https?:\/\//, ''));
        
        return {
          completed,
          confidence: completed ? 0.95 : 0.1,
          reason: completed 
            ? `Successfully navigated to ${targetUrl}`
            : `Not at target URL. Current: ${observation.url}`,
        };
      }
    }

    // Search goals
    if (goalLower.includes('搜索') || goalLower.includes('search') ||
        goalLower.includes('查找') || goalLower.includes('find')) {
      // Check if we're on a results page
      const hasResults = observation.visibleElements?.some(el => 
        el.text?.includes('result') || el.text?.includes('结果') ||
        el.selector.includes('result') || el.selector.includes('search')
      );
      
      return {
        completed: hasResults ?? false,
        confidence: hasResults ? 0.7 : 0.3,
        reason: hasResults 
          ? 'Search results appear to be visible'
          : 'No clear search results detected',
      };
    }

    // Click goals
    if (goalLower.includes('点击') || goalLower.includes('click')) {
      // If we reached this point after a click, likely successful
      return {
        completed: true,
        confidence: 0.6,
        reason: 'Click action completed',
      };
    }

    // Input goals
    if (goalLower.includes('输入') || goalLower.includes('type') ||
        goalLower.includes('填写') || goalLower.includes('fill')) {
      return {
        completed: true,
        confidence: 0.6,
        reason: 'Input action completed',
      };
    }

    // Information query goals
    if (goalLower.includes('是什么') || goalLower.includes('有哪些') ||
        goalLower.includes('what is') || goalLower.includes('what are') ||
        goalLower.includes('告诉我') || goalLower.includes('tell me')) {
      // These are observation goals - if we have page info, consider complete
      return {
        completed: true,
        confidence: 0.8,
        reason: 'Information available from current page state',
      };
    }

    // Default: not sure
    return {
      completed: false,
      confidence: 0.3,
      reason: 'Unable to determine goal completion status',
    };
  }

  /**
   * SA-04: Check for loading indicator
   */
  async hasLoadingIndicator(): Promise<boolean> {
    const page = browserController.getPage();
    if (!page) return false;

    try {
      return await page.evaluate((config) => {
        // Check selector-based indicators
        for (const selector of config.selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              return true;
            }
          }
        }

        // Check text-based indicators
        const bodyText = document.body.innerText || '';
        for (const text of config.texts) {
          if (bodyText.includes(text)) {
            return true;
          }
        }

        return false;
      }, LOADING_INDICATORS);
    } catch {
      return false;
    }
  }

  /**
   * SA-04: Check for modal overlay
   */
  async hasModalOverlay(): Promise<boolean> {
    const page = browserController.getPage();
    if (!page) return false;

    try {
      return await page.evaluate((selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              return true;
            }
          }
        }
        return false;
      }, MODAL_SELECTORS);
    } catch {
      return false;
    }
  }

  /**
   * SA-04: Get intermediate state
   */
  async getIntermediateState(): Promise<{
    isLoading: boolean;
    hasModal: boolean;
    isBlocked: boolean;
    blockedBy?: string;
  }> {
    const isLoading = await this.hasLoadingIndicator();
    const hasModal = await this.hasModalOverlay();
    
    return {
      isLoading,
      hasModal,
      isBlocked: isLoading || hasModal,
      blockedBy: isLoading ? 'loading' : hasModal ? 'modal' : undefined,
    };
  }

  /**
   * SA-05: Set goal context
   */
  setGoalContext(goal: string): void {
    this.goalContext = {
      originalGoal: goal,
      subGoals: [],
      completedSteps: [],
      currentStep: '',
      startTime: new Date().toISOString(),
      lastUpdateTime: new Date().toISOString(),
    };
  }

  /**
   * SA-05: Get goal context
   */
  getGoalContext(): GoalContext | null {
    return this.goalContext;
  }

  /**
   * SA-05: Update goal progress
   */
  updateGoalProgress(step: string, completed: boolean = false): void {
    if (!this.goalContext) return;

    this.goalContext.currentStep = step;
    this.goalContext.lastUpdateTime = new Date().toISOString();
    
    if (completed) {
      this.goalContext.completedSteps.push(step);
    }
  }

  /**
   * SA-05: Add sub-goal
   */
  addSubGoal(subGoal: string): void {
    if (!this.goalContext) return;
    this.goalContext.subGoals.push(subGoal);
  }

  /**
   * SA-06: Capture current page state
   */
  async captureState(): Promise<PageState> {
    const page = browserController.getPage();
    const isLoading = await this.hasLoadingIndicator();
    const hasModal = await this.hasModalOverlay();
    
    let url = '';
    let title = '';
    let visibleElementCount = 0;
    let domHash = '';

    if (page) {
      try {
        url = page.url();
        title = await page.title();
        
        const domInfo = await page.evaluate(() => {
          const elements = document.querySelectorAll('*');
          const visibleCount = Array.from(elements).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }).length;
          
          // Simple hash based on structure
          const hash = document.body.innerHTML.length.toString(36) + 
                      elements.length.toString(36);
          
          return { visibleCount, hash };
        });
        
        visibleElementCount = domInfo.visibleCount;
        domHash = domInfo.hash;
      } catch {
        // Ignore errors
      }
    }

    return {
      url,
      title,
      isLoading,
      hasModalOverlay: hasModal,
      hasLoadingIndicator: isLoading,
      visibleElementCount,
      domHash,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * SA-06: Detect state changes
   */
  async detectStateChange(): Promise<StateChangeResult> {
    const currentState = await this.captureState();
    const changes: StateChange[] = [];

    if (this.previousState) {
      if (this.previousState.url !== currentState.url) {
        changes.push({
          type: 'url',
          before: this.previousState.url,
          after: currentState.url,
          description: `URL changed from ${this.previousState.url} to ${currentState.url}`,
        });
      }

      if (this.previousState.title !== currentState.title) {
        changes.push({
          type: 'title',
          before: this.previousState.title,
          after: currentState.title,
          description: `Title changed to "${currentState.title}"`,
        });
      }

      if (this.previousState.domHash !== currentState.domHash) {
        changes.push({
          type: 'dom',
          before: this.previousState.domHash,
          after: currentState.domHash,
          description: 'DOM structure changed',
        });
      }

      if (this.previousState.isLoading !== currentState.isLoading) {
        changes.push({
          type: 'loading',
          before: this.previousState.isLoading,
          after: currentState.isLoading,
          description: currentState.isLoading ? 'Started loading' : 'Finished loading',
        });
      }

      if (this.previousState.hasModalOverlay !== currentState.hasModalOverlay) {
        changes.push({
          type: 'modal',
          before: this.previousState.hasModalOverlay,
          after: currentState.hasModalOverlay,
          description: currentState.hasModalOverlay ? 'Modal opened' : 'Modal closed',
        });
      }

      const elementDiff = Math.abs(currentState.visibleElementCount - this.previousState.visibleElementCount);
      if (elementDiff > 5) {
        changes.push({
          type: 'elements',
          before: this.previousState.visibleElementCount,
          after: currentState.visibleElementCount,
          description: `Visible elements changed from ${this.previousState.visibleElementCount} to ${currentState.visibleElementCount}`,
        });
      }
    }

    // Store state
    const previousState = this.previousState;
    this.previousState = currentState;
    
    // Add to history
    this.stateHistory.push(currentState);
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }

    return {
      changed: changes.length > 0,
      changes,
      previousState,
      currentState,
    };
  }

  /**
   * SA-06: Wait for state change
   */
  async waitForStateChange(timeout: number = 5000): Promise<StateChangeResult> {
    const startTime = Date.now();
    const initialState = await this.captureState();
    this.previousState = initialState;

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const result = await this.detectStateChange();
      if (result.changed) {
        return result;
      }
    }

    return {
      changed: false,
      changes: [],
      previousState: initialState,
      currentState: await this.captureState(),
    };
  }

  /**
   * Get state history
   */
  getStateHistory(): PageState[] {
    return [...this.stateHistory];
  }

  /**
   * Clear state
   */
  clear(): void {
    this.previousState = null;
    this.goalContext = null;
    this.stateHistory = [];
  }
}

// Export singleton
export const stateAwareness = new StateAwareness();

// Export factory
export function createStateAwareness(): StateAwareness {
  return new StateAwareness();
}

