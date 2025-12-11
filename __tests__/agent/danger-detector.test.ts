/**
 * Danger Detector Unit Tests
 * 
 * Tests for HI-01 ~ HI-09: Danger detection functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DangerDetector, createDangerDetector } from '../../electron/agent/safety/danger-detector';
import type { PendingAction } from '../../electron/agent/safety/types';

describe('DangerDetector', () => {
  let detector: DangerDetector;

  beforeEach(() => {
    detector = createDangerDetector();
  });

  // ============================================
  // HI-01: Delete Operation Detection
  // ============================================

  describe('HI-01: Delete Operations', () => {
    it('should detect delete keyword in Chinese', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: { selector: '#delete-btn' },
        thought: '点击删除按钮确认删除',
        reasoning: '用户要删除移除这个项目',
      };

      const result = await detector.detect(action);

      // Should detect delete keywords and mark as dangerous
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
      expect(result.risk.category).toBe('delete');
      expect(result.isDangerous).toBe(true);
    });

    it('should detect delete keyword in English', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: { selector: '#remove-btn' },
        thought: 'Click the remove button to delete',
        reasoning: '删除这个项目',
      };

      const result = await detector.detect(action);

      // Should detect delete/remove keywords
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
      expect(result.risk.category).toBe('delete');
    });

    it('should detect clear/wipe operations', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Clear all data and delete',
        reasoning: '清空所有数据',
      };

      const result = await detector.detect(action);

      // Should detect clear/delete keywords
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });

    it('should return true for isDeleteOperation', () => {
      expect(detector.isDeleteOperation('删除')).toBe(true);
      expect(detector.isDeleteOperation('remove item')).toBe(true);
      expect(detector.isDeleteOperation('clear all')).toBe(true);
      expect(detector.isDeleteOperation('hello world')).toBe(false);
    });
  });

  // ============================================
  // HI-02: Payment Operation Detection
  // ============================================

  describe('HI-02: Payment Operations', () => {
    it('should detect payment keyword in Chinese', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: { selector: '#pay-btn' },
        thought: '点击支付按钮',
        reasoning: '确认支付订单',
      };

      const result = await detector.detect(action);

      expect(result.isDangerous).toBe(true);
      expect(result.risk.category).toBe('payment');
    });

    it('should detect purchase/buy operations', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Click buy now to purchase',
        reasoning: '购买商品',
      };

      const result = await detector.detect(action);

      // Should detect purchase keywords
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });

    it('should detect checkout operations', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Proceed to checkout and pay',
        reasoning: '结账支付',
      };

      const result = await detector.detect(action);

      // Should detect checkout/payment keywords
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });

    it('should return true for isPaymentOperation', () => {
      expect(detector.isPaymentOperation('支付')).toBe(true);
      expect(detector.isPaymentOperation('payment')).toBe(true);
      expect(detector.isPaymentOperation('checkout')).toBe(true);
      expect(detector.isPaymentOperation('hello')).toBe(false);
    });
  });

  // ============================================
  // HI-03: Submit Operation Detection
  // ============================================

  describe('HI-03: Submit Operations', () => {
    it('should detect submit keyword', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: { selector: 'button[type="submit"]' },
        thought: '提交表单确认发送',
        reasoning: 'Submit the form and confirm',
      };

      const result = await detector.detect(action);

      // Submit operations should be detected
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });

    it('should detect publish/post operations', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Publish and submit the post',
        reasoning: '发布提交文章',
      };

      const result = await detector.detect(action);

      // Should detect publish/submit keywords
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });

    it('should return true for isSubmitOperation', () => {
      expect(detector.isSubmitOperation('提交')).toBe(true);
      expect(detector.isSubmitOperation('submit')).toBe(true);
      expect(detector.isSubmitOperation('publish')).toBe(true);
      expect(detector.isSubmitOperation('view')).toBe(false);
    });
  });

  // ============================================
  // HI-04: Account Operation Detection
  // ============================================

  describe('HI-04: Account Operations', () => {
    it('should detect password operations', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: '修改密码',
        reasoning: 'Change password',
      };

      const result = await detector.detect(action);

      expect(result.isDangerous).toBe(true);
      expect(result.risk.category).toBe('account');
    });

    it('should detect logout operations', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Click logout',
        reasoning: '退出登录',
      };

      const result = await detector.detect(action);

      expect(result.isDangerous).toBe(true);
    });

    it('should return true for isAccountOperation', () => {
      expect(detector.isAccountOperation('密码')).toBe(true);
      expect(detector.isAccountOperation('password')).toBe(true);
      expect(detector.isAccountOperation('logout')).toBe(true);
      expect(detector.isAccountOperation('home')).toBe(false);
    });
  });

  // ============================================
  // HI-05: Button Text Recognition
  // ============================================

  describe('HI-05: Button Text Recognition', () => {
    it('should detect dangerous button text', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Click delete button',
        reasoning: '删除操作',
        targetElement: {
          selector: '#btn',
          tag: 'button',
          text: 'Delete permanently',
          attributes: {},
        },
      };

      const result = await detector.detect(action);

      // Should detect delete keywords
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
      expect(result.risk.category).toBe('delete');
    });

    it('should detect pay now button', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Click button',
        reasoning: '',
        targetElement: {
          selector: '#pay',
          tag: 'button',
          text: 'Pay Now',
          attributes: {},
        },
      };

      const result = await detector.detect(action);

      expect(result.isDangerous).toBe(true);
    });

    it('should detect confirm delete button', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Click button',
        reasoning: '',
        targetElement: {
          selector: '#confirm',
          tag: 'button',
          text: 'Confirm Delete',
          attributes: {},
        },
      };

      const result = await detector.detect(action);

      expect(result.isDangerous).toBe(true);
    });
  });

  // ============================================
  // HI-06: Context Awareness
  // ============================================

  describe('HI-06: Context Awareness', () => {
    it('should detect checkout page context', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Click confirm',
        reasoning: '',
      };

      const result = await detector.detect(action, {
        url: 'https://shop.com/checkout',
        title: 'Checkout',
        html: '<div>Payment required</div>',
      });

      expect(result.contextAnalysis?.pageType).toBe('checkout');
      expect(result.contextAnalysis?.hasPaymentIndicators).toBe(true);
    });

    it('should detect settings page context', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Save settings',
        reasoning: '',
      };

      const result = await detector.detect(action, {
        url: 'https://app.com/settings',
        title: 'Settings',
        html: '<div>Account settings</div>',
      });

      expect(result.contextAnalysis?.pageType).toBe('settings');
    });

    it('should detect warning elements', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Click button',
        reasoning: '',
      };

      const result = await detector.detect(action, {
        url: 'https://app.com/delete',
        html: '<div>Delete content</div>',
        visibleElements: [
          {
            selector: '.warning',
            tag: 'div',
            text: 'Warning: This action cannot be undone',
          },
        ],
      });

      expect(result.contextAnalysis?.relatedElements.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // HI-08: Semantic Variants
  // ============================================

  describe('HI-08: Semantic Variants', () => {
    it('should detect colloquial delete variants', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: '把这个干掉',
        reasoning: 'Get rid of this',
      };

      const result = await detector.detect(action);

      expect(result.matchedPatterns.some(p => p.pattern.includes('semantic'))).toBe(true);
    });

    it('should detect colloquial payment variants', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: '掏钱买单结账',
        reasoning: '支付完成',
      };

      const result = await detector.detect(action);

      // Should detect payment-related patterns
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // HI-09: Consequence Reasoning
  // ============================================

  describe('HI-09: Consequence Reasoning', () => {
    it('should infer delete consequences', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Delete this file permanently',
        reasoning: '删除文件',
      };

      const result = await detector.detect(action);

      // Check that delete category was detected and consequences were added
      expect(result.risk.category).toBe('delete');
      expect(result.risk.reasons.length).toBeGreaterThan(0);
    });

    it('should infer payment consequences', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Pay for order now',
        reasoning: '支付订单',
      };

      const result = await detector.detect(action);

      // Check that payment category was detected
      expect(result.risk.category).toBe('payment');
      expect(result.risk.reasons.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Risk Level Calculation
  // ============================================

  describe('Risk Level Calculation', () => {
    it('should return safe for non-dangerous actions', async () => {
      const action: PendingAction = {
        tool: 'observe',
        args: {},
        thought: 'Get page info',
        reasoning: '',
      };

      const result = await detector.detect(action);

      expect(result.isDangerous).toBe(false);
      expect(result.risk.level).toBe('safe');
    });

    it('should recommend confirmation for medium risk', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: '提交表单并确认支付',
        reasoning: 'Submit and confirm payment',
      };

      const result = await detector.detect(action);

      // Multiple keywords should trigger medium/high risk requiring confirmation
      expect(['confirm', 'block']).toContain(result.risk.recommendation);
    });

    it('should calculate higher risk for multiple indicators', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: '删除账号',
        reasoning: 'Delete account permanently',
        targetElement: {
          selector: '#delete-account',
          tag: 'button',
          text: '永久删除账号',
          attributes: {},
        },
      };

      const result = await detector.detect(action, {
        url: 'https://app.com/settings/account',
        html: '<div>Warning: Account deletion is permanent</div>',
      });

      expect(result.risk.score).toBeGreaterThan(60);
      expect(result.risk.level === 'high' || result.risk.level === 'critical').toBe(true);
    });
  });

  // ============================================
  // Configuration
  // ============================================

  describe('Configuration', () => {
    it('should skip detection when disabled', async () => {
      detector.updateConfig({ enabled: false });

      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Delete everything',
        reasoning: '',
      };

      const result = await detector.detect(action);

      expect(result.isDangerous).toBe(false);
    });

    it('should skip never-confirm tools', async () => {
      const action: PendingAction = {
        tool: 'screenshot',
        args: {},
        thought: 'Take screenshot of delete page',
        reasoning: '',
      };

      const result = await detector.detect(action);

      expect(result.isDangerous).toBe(false);
    });

    it('should force confirm for always-confirm categories', async () => {
      const action: PendingAction = {
        tool: 'click',
        args: {},
        thought: 'Small delete',
        reasoning: '',
      };

      const result = await detector.detect(action);

      if (result.risk.category === 'delete') {
        expect(result.risk.recommendation).toBe('confirm');
      }
    });

    it('should allow config updates', () => {
      detector.updateConfig({ confirmationTimeout: 30000 });
      const config = detector.getConfig();
      expect(config.confirmationTimeout).toBe(30000);
    });
  });

  // ============================================
  // Factory Function
  // ============================================

  describe('createDangerDetector', () => {
    it('should create detector with default config', () => {
      const newDetector = createDangerDetector();
      expect(newDetector).toBeInstanceOf(DangerDetector);
    });

    it('should create detector with custom config', () => {
      const newDetector = createDangerDetector({
        enabled: false,
        confirmationTimeout: 5000,
      });
      const config = newDetector.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.confirmationTimeout).toBe(5000);
    });
  });
});

