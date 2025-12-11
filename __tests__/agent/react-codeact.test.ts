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

// ============================================
// Gating Logic 边界情况测试 (GL-01 ~ GL-05)
// ============================================

describe('GatingLogic - Edge Cases', () => {
  let gating: GatingLogic;

  beforeEach(() => {
    gating = createGatingLogic();
  });

  // GL-01: DOM 大小触发边界测试
  describe('GL-01: DOM Size Threshold', () => {
    it('should NOT trigger at exactly 10000 chars', () => {
      const context: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Click',
        actionHistory: [],
        consecutiveSelectorFailures: 0,
        domSize: 10000, // exactly at threshold
        userInstruction: 'Click button',
      };

      const decision = gating.shouldTriggerCodeAct(context);
      expect(decision.triggeredRules).not.toContain('dom_size');
    });

    it('should trigger at 10001 chars', () => {
      const context: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Click',
        actionHistory: [],
        consecutiveSelectorFailures: 0,
        domSize: 10001, // just above threshold
        userInstruction: 'Click button',
      };

      const decision = gating.shouldTriggerCodeAct(context);
      expect(decision.shouldUseCodeAct).toBe(true);
      expect(decision.triggeredRules).toContain('dom_size');
    });

    it('should have higher confidence for larger DOM', () => {
      const smallContext: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Click',
        actionHistory: [],
        consecutiveSelectorFailures: 0,
        domSize: 11000,
        userInstruction: 'Click button',
      };

      const largeContext: GatingContext = {
        ...smallContext,
        domSize: 50000,
      };

      const smallDecision = gating.shouldTriggerCodeAct(smallContext);
      const largeDecision = gating.shouldTriggerCodeAct(largeContext);

      expect(largeDecision.confidence).toBeGreaterThan(smallDecision.confidence);
    });
  });

  // GL-02: 选择器失败触发边界测试
  describe('GL-02: Selector Failures Threshold', () => {
    it('should NOT trigger at 1 failure', () => {
      const context: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Click',
        actionHistory: [],
        consecutiveSelectorFailures: 1,
        domSize: 1000,
        userInstruction: 'Click button',
      };

      const decision = gating.shouldTriggerCodeAct(context);
      expect(decision.triggeredRules).not.toContain('selector_failures');
    });

    it('should trigger at exactly 2 failures', () => {
      const context: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Click',
        actionHistory: [],
        consecutiveSelectorFailures: 2,
        domSize: 1000,
        userInstruction: 'Click button',
      };

      const decision = gating.shouldTriggerCodeAct(context);
      expect(decision.shouldUseCodeAct).toBe(true);
      expect(decision.triggeredRules).toContain('selector_failures');
    });
  });

  // GL-03: 数据提取识别测试
  describe('GL-03: Data Extraction Keywords', () => {
    const dataExtractionPhrases = [
      '提取所有链接',
      '获取所有按钮',
      '列出所有元素',
      '找到所有输入框',
      'extract all links',
      'get all buttons',
      'list all elements',
      'find all inputs',
      '导出数据',
      'export data',
      '下载列表',
      'download list',
    ];

    dataExtractionPhrases.forEach(phrase => {
      it(`should detect data extraction: "${phrase}"`, () => {
        expect(isDataExtractionTask(phrase)).toBe(true);
      });
    });

    const nonDataExtractionPhrases = [
      '点击按钮',
      'click button',
      '输入文本',
      'type text',
      '提交表单',
      'submit form',
    ];

    nonDataExtractionPhrases.forEach(phrase => {
      it(`should NOT detect data extraction: "${phrase}"`, () => {
        expect(isDataExtractionTask(phrase)).toBe(false);
      });
    });
  });

  // GL-04: 复杂逻辑识别测试
  describe('GL-04: Complex Logic Keywords', () => {
    const complexLogicPhrases = [
      '找到最便宜的',
      '找到最贵的',
      '最高评分',
      '最低价格',
      '排序结果',
      'cheapest item',
      'most expensive',
      'highest rating',
      'lowest price',
      'sort by',
      '比较价格',
      '筛选结果',
      '过滤数据',
      'compare prices',
      'filter results',
      '最接近的匹配',
      'closest match',
    ];

    complexLogicPhrases.forEach(phrase => {
      it(`should detect complex logic: "${phrase}"`, () => {
        expect(isComplexLogicTask(phrase)).toBe(true);
      });
    });

    const simpleLogicPhrases = [
      '点击登录',
      'click login',
      '输入密码',
      'enter password',
    ];

    simpleLogicPhrases.forEach(phrase => {
      it(`should NOT detect complex logic: "${phrase}"`, () => {
        expect(isComplexLogicTask(phrase)).toBe(false);
      });
    });
  });

  // GL-05: 禁用开关测试
  describe('GL-05: Enable/Disable Toggle', () => {
    it('should not trigger any rules when disabled', () => {
      gating.setEnabled(false);

      const context: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Extract',
        actionHistory: [],
        consecutiveSelectorFailures: 10,
        domSize: 100000,
        userInstruction: '提取所有链接并排序',
      };

      const decision = gating.shouldTriggerCodeAct(context);
      expect(decision.shouldUseCodeAct).toBe(false);
      expect(decision.triggeredRules).toHaveLength(0);
      expect(decision.confidence).toBe(0);
    });

    it('should work again after re-enabling', () => {
      gating.setEnabled(false);
      gating.setEnabled(true);

      const context: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Extract',
        actionHistory: [],
        consecutiveSelectorFailures: 0,
        domSize: 15000,
        userInstruction: 'Click button',
      };

      const decision = gating.shouldTriggerCodeAct(context);
      expect(decision.shouldUseCodeAct).toBe(true);
    });
  });

  // 多规则触发测试
  describe('Multiple Rules Trigger', () => {
    it('should trigger multiple rules simultaneously', () => {
      const context: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Extract and sort',
        actionHistory: [],
        consecutiveSelectorFailures: 3,
        domSize: 20000,
        userInstruction: '提取所有链接并按价格排序',
      };

      const decision = gating.shouldTriggerCodeAct(context);
      expect(decision.shouldUseCodeAct).toBe(true);
      expect(decision.triggeredRules.length).toBeGreaterThan(1);
      expect(decision.triggeredRules).toContain('dom_size');
      expect(decision.triggeredRules).toContain('selector_failures');
      expect(decision.triggeredRules).toContain('data_extraction');
      expect(decision.triggeredRules).toContain('complex_logic');
    });

    it('should provide suggested task based on first triggered rule', () => {
      const context: GatingContext = {
        observation: { timestamp: new Date().toISOString(), url: '', title: '' },
        goal: 'Find element',
        actionHistory: [],
        consecutiveSelectorFailures: 0,
        domSize: 15000,
        userInstruction: 'Click button',
      };

      const decision = gating.shouldTriggerCodeAct(context);
      expect(decision.suggestedTask).toBeDefined();
      expect(decision.suggestedTask?.length).toBeGreaterThan(0);
    });
  });

  // createContext 边界测试
  describe('GatingLogic.createContext Edge Cases', () => {
    it('should calculate domSize from visibleElements when no domSnapshot', () => {
      const observation: Observation = {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
        visibleElements: [
          { tag: 'button', text: 'x'.repeat(5000), selector: '#btn', attributes: {}, isVisible: true, isInteractable: true },
          { tag: 'button', text: 'y'.repeat(5000), selector: '#btn2', attributes: {}, isVisible: true, isInteractable: true },
        ],
      };

      const context = GatingLogic.createContext(observation, 'Find', 'Click', []);
      expect(context.domSize).toBeGreaterThan(10000);
    });

    it('should count consecutive selector failures from action history', () => {
      const actionHistory = [
        { id: '1', tool: 'click', args: {}, result: { success: false }, thought: '', reasoning: '', confidence: 0.5, requiresCodeAct: false, timestamp: '' },
        { id: '2', tool: 'click', args: {}, result: { success: false }, thought: '', reasoning: '', confidence: 0.5, requiresCodeAct: false, timestamp: '' },
        { id: '3', tool: 'click', args: {}, result: { success: false }, thought: '', reasoning: '', confidence: 0.5, requiresCodeAct: false, timestamp: '' },
      ];

      const observation: Observation = {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
      };

      const context = GatingLogic.createContext(observation, 'Find', 'Click', actionHistory as any);
      expect(context.consecutiveSelectorFailures).toBe(3);
    });

    it('should reset failure count after successful action', () => {
      const actionHistory = [
        { id: '1', tool: 'click', args: {}, result: { success: false }, thought: '', reasoning: '', confidence: 0.5, requiresCodeAct: false, timestamp: '' },
        { id: '2', tool: 'click', args: {}, result: { success: true }, thought: '', reasoning: '', confidence: 0.5, requiresCodeAct: false, timestamp: '' },
        { id: '3', tool: 'click', args: {}, result: { success: false }, thought: '', reasoning: '', confidence: 0.5, requiresCodeAct: false, timestamp: '' },
      ];

      const observation: Observation = {
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        title: 'Test',
      };

      const context = GatingLogic.createContext(observation, 'Find', 'Click', actionHistory as any);
      expect(context.consecutiveSelectorFailures).toBe(1);
    });
  });
});

// ============================================
// 边界情况和真实 DOM 场景测试
// ============================================

describe('CodeExecutor - Edge Cases', () => {
  let executor: CodeExecutor;

  beforeEach(() => {
    executor = createCodeExecutor(5000);
  });

  // CA-03: DOM 解析边界情况
  describe('DOM Parsing Edge Cases', () => {
    it('should handle empty HTML gracefully', async () => {
      const result = await executor.execute({
        code: `extractButtons(context.html)`,
        language: 'javascript',
        context: { html: '' },
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual([]);
    });

    it('should handle HTML with no buttons', async () => {
      const html = '<div><p>Hello World</p><span>No buttons here</span></div>';
      const result = await executor.execute({
        code: `extractButtons(context.html)`,
        language: 'javascript',
        context: { html },
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual([]);
    });

    it('should extract buttons with various attributes', async () => {
      const html = `
        <div>
          <button id="btn1" data-testid="login-btn">Login</button>
          <button class="submit-btn">Submit</button>
          <input type="submit" value="Send" />
          <div role="button">Click me</div>
        </div>
      `;
      const result = await executor.execute({
        code: `extractButtons(context.html)`,
        language: 'javascript',
        context: { html },
      });

      expect(result.success).toBe(true);
      const buttons = result.result as Array<{ text: string; selector: string }>;
      expect(buttons.length).toBe(4);
    });

    it('should handle deeply nested DOM structure', async () => {
      const html = `
        <div>
          <div>
            <div>
              <div>
                <button id="deep-btn">Deep Button</button>
              </div>
            </div>
          </div>
        </div>
      `;
      const result = await executor.execute({
        code: `extractButtons(context.html)`,
        language: 'javascript',
        context: { html },
      });

      expect(result.success).toBe(true);
      const buttons = result.result as Array<{ text: string; selector: string }>;
      expect(buttons.length).toBe(1);
      expect(buttons[0].text).toBe('Deep Button');
      expect(buttons[0].selector).toBe('#deep-btn');
    });

    it('should handle special characters in button text', async () => {
      const html = `<button>"Click & Save" <script>alert(1)</script></button>`;
      const result = await executor.execute({
        code: `extractButtons(context.html)`,
        language: 'javascript',
        context: { html },
      });

      expect(result.success).toBe(true);
      const buttons = result.result as Array<{ text: string }>;
      expect(buttons.length).toBe(1);
    });

    it('should extract links correctly', async () => {
      const html = `
        <div>
          <a href="/home">Home</a>
          <a href="https://example.com">External</a>
          <a href="#">Empty Hash</a>
        </div>
      `;
      const result = await executor.execute({
        code: `extractLinks(context.html)`,
        language: 'javascript',
        context: { html },
      });

      expect(result.success).toBe(true);
      const links = result.result as Array<{ href: string; text: string }>;
      expect(links.length).toBe(3);
      expect(links[0].href).toBe('/home');
      expect(links[0].text).toBe('Home');
    });

    it('should extract form inputs correctly', async () => {
      const html = `
        <form>
          <input type="text" id="username" name="user" placeholder="Username" />
          <input type="password" name="pass" />
          <textarea id="bio"></textarea>
          <select name="country"><option>US</option></select>
        </form>
      `;
      const result = await executor.execute({
        code: `extractInputs(context.html)`,
        language: 'javascript',
        context: { html },
      });

      expect(result.success).toBe(true);
      const inputs = result.result as Array<{ name: string; id: string; selector: string }>;
      expect(inputs.length).toBe(4);
    });
  });

  // CA-04: 数据处理边界情况
  describe('Data Processing Edge Cases', () => {
    it('should handle empty array for sortBy', async () => {
      const result = await executor.execute({
        code: `sortBy([], 'price')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual([]);
    });

    it('should handle array with missing key for sortBy', async () => {
      const result = await executor.execute({
        code: `sortBy([{ name: 'a' }, { price: 10 }], 'price')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.result)).toBe(true);
    });

    it('should sort in descending order with sortByDesc', async () => {
      const result = await executor.execute({
        code: `sortByDesc([{ price: 10 }, { price: 30 }, { price: 20 }], 'price')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual([
        { price: 30 },
        { price: 20 },
        { price: 10 },
      ]);
    });

    it('should filter array correctly', async () => {
      const result = await executor.execute({
        code: `filterBy([{ active: true }, { active: false }, { active: true }], item => item.active)`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect((result.result as Array<{ active: boolean }>).length).toBe(2);
    });

    it('should group array by key', async () => {
      const result = await executor.execute({
        code: `groupBy([{ type: 'a', v: 1 }, { type: 'b', v: 2 }, { type: 'a', v: 3 }], 'type')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      const grouped = result.result as Record<string, Array<{ type: string }>>;
      expect(grouped['a'].length).toBe(2);
      expect(grouped['b'].length).toBe(1);
    });

    it('should get unique values', async () => {
      const result = await executor.execute({
        code: `unique([1, 2, 2, 3, 3, 3])`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual([1, 2, 3]);
    });

    it('should get unique by key', async () => {
      const result = await executor.execute({
        code: `uniqueBy([{ id: 1, name: 'a' }, { id: 1, name: 'b' }, { id: 2, name: 'c' }], 'id')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect((result.result as Array<{ id: number }>).length).toBe(2);
    });
  });

  // CA-05: 模糊匹配边界情况
  describe('Fuzzy Matching Edge Cases', () => {
    it('should return 1 for identical strings', async () => {
      const result = await executor.execute({
        code: `similarity('hello', 'hello')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(1);
    });

    it('should return 0 for empty string comparison', async () => {
      const result = await executor.execute({
        code: `similarity('', 'hello')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(0);
    });

    it('should be case insensitive for similarity', async () => {
      const result = await executor.execute({
        code: `similarity('HELLO', 'hello')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(1);
    });

    it('should find no match in empty elements array', async () => {
      const result = await executor.findElement([], 'login button');

      expect(result.success).toBe(true);
      expect((result.result as { found: boolean }).found).toBe(false);
    });

    it('should match element by aria-label', async () => {
      const elements: ElementInfo[] = [
        {
          selector: '#btn',
          tag: 'button',
          text: '',
          attributes: { id: 'btn', 'aria-label': 'Login Button' },
          isVisible: true,
          isInteractable: true,
        },
      ];

      const result = await executor.findElement(elements, 'login');

      expect(result.success).toBe(true);
      expect((result.result as { found: boolean }).found).toBe(true);
    });

    it('should match element by placeholder', async () => {
      const elements: ElementInfo[] = [
        {
          selector: '#email',
          tag: 'input',
          text: '',
          attributes: { id: 'email', placeholder: 'Enter your email' },
          isVisible: true,
          isInteractable: true,
        },
      ];

      const result = await executor.findElement(elements, 'email');

      expect(result.success).toBe(true);
      expect((result.result as { found: boolean }).found).toBe(true);
    });

    it('should prefer interactable visible elements', async () => {
      const elements: ElementInfo[] = [
        {
          selector: '#hidden-btn',
          tag: 'button',
          text: 'Login',
          attributes: { id: 'hidden-btn' },
          isVisible: false,
          isInteractable: false,
        },
        {
          selector: '#visible-btn',
          tag: 'button',
          text: 'Login',
          attributes: { id: 'visible-btn' },
          isVisible: true,
          isInteractable: true,
        },
      ];

      const result = await executor.findElement(elements, 'login');

      expect(result.success).toBe(true);
      const found = result.result as { found: boolean; selector: string };
      expect(found.found).toBe(true);
      expect(found.selector).toBe('#visible-btn');
    });

    it('should perform fuzzy match correctly', async () => {
      const result = await executor.execute({
        code: `fuzzyMatch('login button submit', 'lbs')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(true);
    });

    it('should check contains correctly', async () => {
      const result = await executor.execute({
        code: `contains('Hello World', 'world')`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(true);
    });
  });

  // CA-01/CA-02: 沙箱安全和错误处理
  describe('Sandbox Security and Error Handling', () => {
    it('should handle syntax errors gracefully', async () => {
      const result = await executor.execute({
        code: `function( { invalid syntax`,
        language: 'javascript',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle runtime errors gracefully', async () => {
      const result = await executor.execute({
        code: `throw new Error('Test error')`,
        language: 'javascript',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Test error');
    });

    it('should handle undefined variable access', async () => {
      const result = await executor.execute({
        code: `undefinedVariable.property`,
        language: 'javascript',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should provide duration in result', async () => {
      const result = await executor.execute({
        code: `1 + 1`,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.duration).toBeDefined();
      expect(typeof result.duration).toBe('number');
    });

    it('should pass context correctly', async () => {
      const result = await executor.execute({
        code: `context.value * 2`,
        language: 'javascript',
        context: { value: 21 },
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
    });
  });

  // CA-06: Console 捕获增强测试
  describe('Console Capture', () => {
    it('should capture console.error', async () => {
      const result = await executor.execute({
        code: `
          console.error('Error message');
          'done'
        `,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('[ERROR]');
      expect(result.stdout).toContain('Error message');
    });

    it('should capture console.warn', async () => {
      const result = await executor.execute({
        code: `
          console.warn('Warning message');
          'done'
        `,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('[WARN]');
      expect(result.stdout).toContain('Warning message');
    });

    it('should capture object logging', async () => {
      const result = await executor.execute({
        code: `
          console.log({ name: 'test', value: 123 });
          'done'
        `,
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('name');
      expect(result.stdout).toContain('test');
    });
  });
});

// ============================================
// parseDOM 和 extractData 高级方法测试
// ============================================

describe('CodeExecutor - Advanced Methods', () => {
  let executor: CodeExecutor;

  beforeEach(() => {
    executor = createCodeExecutor(5000);
  });

  it('should parse DOM and detect buttons task', async () => {
    const html = '<button>Click me</button>';
    const result = await executor.parseDOM(html, 'find all buttons');

    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
  });

  it('should parse DOM and detect links task', async () => {
    const html = '<a href="/test">Link</a>';
    const result = await executor.parseDOM(html, 'get all links');

    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
  });

  it('should parse DOM and detect inputs task', async () => {
    const html = '<input type="text" />';
    const result = await executor.parseDOM(html, 'find form inputs');

    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
  });

  it('should extract data with selector', async () => {
    const html = '<div class="item">Item 1</div><div class="item">Item 2</div>';
    const result = await executor.extractData(html, '.item');

    expect(result.success).toBe(true);
    const data = result.result as { count: number; items: unknown[] };
    expect(data.count).toBe(2);
    expect(data.items.length).toBe(2);
  });

  it('should process data with sort operation', async () => {
    const data = [{ price: 30 }, { price: 10 }, { price: 20 }];
    const result = await executor.processData(data, 'sort', 'price', 'asc');

    expect(result.success).toBe(true);
    expect(result.result).toEqual([
      { price: 10 },
      { price: 20 },
      { price: 30 },
    ]);
  });

  it('should process data with sort desc operation', async () => {
    const data = [{ price: 30 }, { price: 10 }, { price: 20 }];
    const result = await executor.processData(data, 'sort', 'price', 'desc');

    expect(result.success).toBe(true);
    expect(result.result).toEqual([
      { price: 30 },
      { price: 20 },
      { price: 10 },
    ]);
  });

  it('should process data with group operation', async () => {
    const data = [{ type: 'a' }, { type: 'b' }, { type: 'a' }];
    const result = await executor.processData(data, 'group', 'type');

    expect(result.success).toBe(true);
    const grouped = result.result as Record<string, unknown[]>;
    expect(grouped['a'].length).toBe(2);
    expect(grouped['b'].length).toBe(1);
  });
});

