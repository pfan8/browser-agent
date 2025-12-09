/**
 * ReAct + CodeAct Integration Tests
 * 
 * Tests the hybrid ReAct/CodeAct architecture:
 * - ReactAgent main loop
 * - CodeAct sandbox execution
 * - Gating logic for CodeAct triggering
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CodeExecutor, createCodeExecutor } from '../../electron/agent/tools/code-executor';
import { GatingLogic, createGatingLogic, isDataExtractionTask, isComplexLogicTask } from '../../electron/agent/gating-logic';
import type { Observation, ElementInfo, GatingContext } from '../../electron/agent/types';

describe('CodeExecutor', () => {
  let executor: CodeExecutor;

  beforeEach(() => {
    executor = createCodeExecutor(5000);
  });

  it('should execute simple JavaScript code in sandbox', async () => {
    const result = await executor.execute({
      code: '1 + 2',  // VM evaluates last expression
      language: 'javascript',
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(3);
  });

  it('should have access to sandbox utilities', async () => {
    const result = await executor.execute({
      code: `
        const arr = [{ price: 30 }, { price: 10 }, { price: 20 }];
        sortBy(arr, 'price')
      `,
      language: 'javascript',
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual([
      { price: 10 },
      { price: 20 },
      { price: 30 },
    ]);
  });

  it('should parse HTML with cheerio utilities', async () => {
    const html = '<div><button id="btn1">Login</button><button id="btn2">Sign Up</button></div>';
    
    const result = await executor.execute({
      code: `
        extractButtons(context.html)
      `,
      language: 'javascript',
      context: { html },
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
    expect((result.result as Array<{ text: string }>).length).toBe(2);
  });

  it('should calculate string similarity', async () => {
    const result = await executor.execute({
      code: `
        similarity('login button', 'Login')
      `,
      language: 'javascript',
    });

    expect(result.success).toBe(true);
    expect(typeof result.result).toBe('number');
    expect(result.result as number).toBeGreaterThan(0.3);
  });

  it('should find best element match', async () => {
    const elements: ElementInfo[] = [
      {
        selector: '#submit',
        tag: 'button',
        text: 'Submit Form',
        attributes: { id: 'submit' },
        isVisible: true,
        isInteractable: true,
      },
      {
        selector: '#login',
        tag: 'button',
        text: 'Login',
        attributes: { id: 'login' },
        isVisible: true,
        isInteractable: true,
      },
    ];

    const result = await executor.findElement(elements, 'login button');

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    expect((result.result as { found: boolean }).found).toBe(true);
  });

  it('should handle code execution timeout', async () => {
    const shortExecutor = createCodeExecutor(100);
    
    const result = await shortExecutor.execute({
      code: `
        let i = 0;
        while(true) { i++; }
        i
      `,
      language: 'javascript',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should capture console output', async () => {
    const result = await executor.execute({
      code: `
        console.log('Hello');
        console.log('World');
        'done'
      `,
      language: 'javascript',
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('Hello');
    expect(result.stdout).toContain('World');
  });
});

describe('GatingLogic', () => {
  let gating: GatingLogic;

  beforeEach(() => {
    gating = createGatingLogic();
  });

  it('should detect data extraction tasks', () => {
    expect(isDataExtractionTask('提取所有链接')).toBe(true);
    expect(isDataExtractionTask('get all buttons')).toBe(true);
    expect(isDataExtractionTask('click the button')).toBe(false);
  });

  it('should detect complex logic tasks', () => {
    expect(isComplexLogicTask('找到最便宜的商品')).toBe(true);
    expect(isComplexLogicTask('sort by price')).toBe(true);
    expect(isComplexLogicTask('click submit')).toBe(false);
  });

  it('should trigger CodeAct for large DOM', () => {
    const context: GatingContext = {
      observation: {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
      },
      goal: 'Click button',
      actionHistory: [],
      consecutiveSelectorFailures: 0,
      domSize: 15000, // > 10000 threshold
      userInstruction: 'Click the login button',
    };

    const decision = gating.shouldTriggerCodeAct(context);

    expect(decision.shouldUseCodeAct).toBe(true);
    expect(decision.triggeredRules).toContain('dom_size');
  });

  it('should trigger CodeAct for consecutive selector failures', () => {
    const context: GatingContext = {
      observation: {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
      },
      goal: 'Click button',
      actionHistory: [],
      consecutiveSelectorFailures: 3, // >= 2 threshold
      domSize: 1000,
      userInstruction: 'Click the login button',
    };

    const decision = gating.shouldTriggerCodeAct(context);

    expect(decision.shouldUseCodeAct).toBe(true);
    expect(decision.triggeredRules).toContain('selector_failures');
  });

  it('should trigger CodeAct for data extraction instructions', () => {
    const context: GatingContext = {
      observation: {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
      },
      goal: 'Extract data',
      actionHistory: [],
      consecutiveSelectorFailures: 0,
      domSize: 1000,
      userInstruction: '提取所有链接',
    };

    const decision = gating.shouldTriggerCodeAct(context);

    expect(decision.shouldUseCodeAct).toBe(true);
    expect(decision.triggeredRules).toContain('data_extraction');
  });

  it('should trigger CodeAct for complex logic instructions', () => {
    const context: GatingContext = {
      observation: {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
      },
      goal: 'Find cheapest',
      actionHistory: [],
      consecutiveSelectorFailures: 0,
      domSize: 1000,
      userInstruction: '找到最便宜的商品并点击',
    };

    const decision = gating.shouldTriggerCodeAct(context);

    expect(decision.shouldUseCodeAct).toBe(true);
    expect(decision.triggeredRules).toContain('complex_logic');
  });

  it('should not trigger CodeAct for simple instructions', () => {
    const context: GatingContext = {
      observation: {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
      },
      goal: 'Click button',
      actionHistory: [],
      consecutiveSelectorFailures: 0,
      domSize: 1000,
      userInstruction: 'Click the submit button',
    };

    const decision = gating.shouldTriggerCodeAct(context);

    expect(decision.shouldUseCodeAct).toBe(false);
    expect(decision.triggeredRules).toHaveLength(0);
  });

  it('should be disableable', () => {
    gating.setEnabled(false);

    const context: GatingContext = {
      observation: {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
      },
      goal: 'Extract data',
      actionHistory: [],
      consecutiveSelectorFailures: 0,
      domSize: 15000, // Would normally trigger
      userInstruction: '提取所有链接', // Would normally trigger
    };

    const decision = gating.shouldTriggerCodeAct(context);

    expect(decision.shouldUseCodeAct).toBe(false);
  });
});

describe('GatingLogic.createContext', () => {
  it('should create context from observation and action history', () => {
    const observation: Observation = {
      timestamp: new Date().toISOString(),
      url: 'https://example.com',
      title: 'Test',
      domSnapshot: '<div>' + 'x'.repeat(15000) + '</div>',
    };

    const context = GatingLogic.createContext(
      observation,
      'Find element',
      'Click the button',
      []
    );

    expect(context.observation).toBe(observation);
    expect(context.goal).toBe('Find element');
    expect(context.userInstruction).toBe('Click the button');
    expect(context.domSize).toBeGreaterThan(10000);
  });
});

