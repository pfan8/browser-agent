#!/usr/bin/env tsx
/**
 * Agent CLI - Interactive testing tool for @chat-agent/agent-core
 * 
 * Usage:
 *   pnpm tsx scripts/agent-cli.ts
 * 
 * Features:
 * - Mock browser adapter for testing agent flow
 * - Shows each LLM response in detail
 * - Displays agent state transitions
 * - Interactive CLI for sending tasks
 */

import * as readline from 'readline';
import { 
  BrowserAgent, 
  createBrowserTools, 
  type AgentState,
  type AgentConfig,
} from '../packages/agent-core/src';
import type { 
  IBrowserAdapter, 
  OperationResult, 
  BrowserStatus, 
  PageInfo, 
  TabInfo 
} from '../packages/browser-adapter/src/types';

// ============================================
// ANSI Colors for better CLI output
// ============================================
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
};

function log(prefix: string, color: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${prefix}${colors.reset} ${message}`);
  if (data !== undefined) {
    console.log(colors.dim + JSON.stringify(data, null, 2) + colors.reset);
  }
}

function logNode(node: string, message: string) {
  const nodeColors: Record<string, string> = {
    observe: colors.cyan,
    think: colors.magenta,
    act: colors.green,
  };
  const color = nodeColors[node] || colors.white;
  log(`[${node.toUpperCase()}]`, color, message);
}

function logLLM(response: string) {
  console.log(`\n${colors.bgBlue}${colors.white} LLM RESPONSE ${colors.reset}`);
  console.log(colors.blue + '─'.repeat(60) + colors.reset);
  console.log(response);
  console.log(colors.blue + '─'.repeat(60) + colors.reset + '\n');
}

function logState(state: Partial<AgentState>) {
  console.log(`\n${colors.bgYellow}${colors.bright} AGENT STATE ${colors.reset}`);
  console.log(colors.yellow + '─'.repeat(60) + colors.reset);
  console.log(`  Status: ${colors.bright}${state.status}${colors.reset}`);
  console.log(`  Iteration: ${state.iterationCount}`);
  console.log(`  Consecutive Failures: ${state.consecutiveFailures}`);
  console.log(`  Loop Detected: ${state.loopDetected}`);
  console.log(`  Is Complete: ${state.isComplete}`);
  if (state.goal) {
    console.log(`  Goal: ${colors.cyan}${state.goal}${colors.reset}`);
  }
  if (state.error) {
    console.log(`  Error: ${colors.red}${state.error}${colors.reset}`);
  }
  if (state.result) {
    console.log(`  Result: ${colors.green}${state.result}${colors.reset}`);
  }
  console.log(colors.yellow + '─'.repeat(60) + colors.reset + '\n');
}

function logAction(action: { tool: string; args: Record<string, unknown>; thought?: string }) {
  console.log(`\n${colors.bgGreen}${colors.bright} ACTION ${colors.reset}`);
  console.log(colors.green + '─'.repeat(60) + colors.reset);
  console.log(`  Tool: ${colors.bright}${action.tool}${colors.reset}`);
  console.log(`  Args: ${JSON.stringify(action.args)}`);
  if (action.thought) {
    console.log(`  Thought: ${colors.dim}${action.thought}${colors.reset}`);
  }
  console.log(colors.green + '─'.repeat(60) + colors.reset + '\n');
}

// ============================================
// Mock Browser Adapter
// ============================================
class MockBrowserAdapter implements IBrowserAdapter {
  private connected = false;
  private currentUrl = 'about:blank';
  private currentTitle = 'New Tab';
  private pageContent = '<html><body><h1>Mock Page</h1></body></html>';
  private eventHandlers: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  
  // Simulated page states for different URLs
  private mockPages: Record<string, { title: string; content: string }> = {
    'https://example.com': {
      title: 'Example Domain',
      content: '<html><body><h1>Example Domain</h1><p>This domain is for use in illustrative examples.</p><a href="https://www.iana.org/domains/example">More information...</a></body></html>',
    },
    'https://google.com': {
      title: 'Google',
      content: '<html><body><input name="q" placeholder="Search Google"/><button>Google Search</button></body></html>',
    },
    'https://github.com': {
      title: 'GitHub',
      content: '<html><body><input placeholder="Search or jump to..."/><a href="/login">Sign in</a></body></html>',
    },
  };

  async connect(cdpUrl: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Connecting to ${cdpUrl}`);
    await this.delay(100);
    this.connected = true;
    return { success: true };
  }

  async disconnect(): Promise<void> {
    log('[MOCK]', colors.dim, 'Disconnecting');
    this.connected = false;
  }

  async reconnect(): Promise<OperationResult> {
    return this.connect('mock://localhost:9222');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getStatus(): Promise<BrowserStatus> {
    return {
      connected: this.connected,
      url: this.currentUrl,
      title: this.currentTitle,
    };
  }

  getCdpUrl(): string {
    return 'mock://localhost:9222';
  }

  getLastConnectionError(): string | null {
    return null;
  }

  async navigate(url: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Navigating to ${url}`);
    await this.delay(200);
    
    this.currentUrl = url;
    const mockPage = this.mockPages[url];
    if (mockPage) {
      this.currentTitle = mockPage.title;
      this.pageContent = mockPage.content;
    } else {
      this.currentTitle = `Page: ${url}`;
      this.pageContent = `<html><body><h1>Page at ${url}</h1></body></html>`;
    }
    
    this.emit('pageLoad', { url });
    return { success: true };
  }

  async goBack(): Promise<OperationResult> {
    log('[MOCK]', colors.dim, 'Going back');
    return { success: true };
  }

  async goForward(): Promise<OperationResult> {
    log('[MOCK]', colors.dim, 'Going forward');
    return { success: true };
  }

  async click(selector: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Clicking ${selector}`);
    await this.delay(100);
    
    // Simulate some click failures for testing error recovery
    if (selector.includes('nonexistent')) {
      return { success: false, error: `Element not found: ${selector}` };
    }
    
    return { success: true, data: { clicked: selector } };
  }

  async type(selector: string, text: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Typing "${text}" into ${selector}`);
    await this.delay(100);
    return { success: true, data: { typed: text, into: selector } };
  }

  async press(key: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Pressing key: ${key}`);
    await this.delay(50);
    return { success: true };
  }

  async hover(selector: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Hovering ${selector}`);
    return { success: true };
  }

  async select(selector: string, value: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Selecting "${value}" in ${selector}`);
    return { success: true };
  }

  async wait(ms: number): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Waiting ${ms}ms`);
    await this.delay(Math.min(ms, 1000)); // Cap at 1s for testing
    return { success: true };
  }

  async waitForSelector(selector: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Waiting for selector: ${selector}`);
    await this.delay(100);
    
    if (selector.includes('nonexistent')) {
      return { success: false, error: `Timeout waiting for: ${selector}` };
    }
    
    return { success: true };
  }

  async screenshot(name?: string): Promise<OperationResult> {
    const path = name || `screenshot_${Date.now()}.png`;
    log('[MOCK]', colors.dim, `Taking screenshot: ${path}`);
    return { success: true, data: { path } };
  }

  async getPageInfo(): Promise<PageInfo> {
    return {
      url: this.currentUrl,
      title: this.currentTitle,
    };
  }

  async getPageContent(): Promise<string> {
    return this.pageContent;
  }

  async evaluateSelector(description: string): Promise<{ selector: string; alternatives: string[] }> {
    log('[MOCK]', colors.dim, `Evaluating selector for: ${description}`);
    // Return mock selectors based on description
    const selectorMap: Record<string, string> = {
      'search': 'input[name="q"]',
      'button': 'button',
      'link': 'a',
      'input': 'input',
    };
    
    const selector = Object.entries(selectorMap).find(([key]) => 
      description.toLowerCase().includes(key)
    )?.[1] || `[data-testid="${description}"]`;
    
    return { selector, alternatives: [] };
  }

  async listPages(): Promise<TabInfo[]> {
    return [{
      index: 0,
      url: this.currentUrl,
      title: this.currentTitle,
      active: true,
    }];
  }

  async switchToPage(index: number): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Switching to page ${index}`);
    return { success: true };
  }

  async closePage(): Promise<OperationResult> {
    log('[MOCK]', colors.dim, 'Closing page');
    return { success: true };
  }

  async runCode(code: string): Promise<OperationResult> {
    log('[MOCK]', colors.dim, `Running code: ${code.substring(0, 50)}...`);
    return { success: true, data: { result: 'mock result' } };
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.eventHandlers.get(event)?.forEach(handler => handler(...args));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// CLI Interface
// ============================================
class AgentCLI {
  private rl: readline.Interface;
  private agent: BrowserAgent | null = null;
  private browserAdapter: MockBrowserAdapter;
  private apiKey: string;
  private baseUrl?: string;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.browserAdapter = new MockBrowserAdapter();
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = process.env.ANTHROPIC_BASE_URL;
  }

  async start() {
    this.printBanner();
    
    // Check API key
    if (!this.apiKey) {
      console.log(`${colors.yellow}Warning: ANTHROPIC_API_KEY not set. LLM calls will fail.${colors.reset}`);
      console.log(`Set it with: export ANTHROPIC_API_KEY=your-key\n`);
    }

    // Initialize agent
    await this.initAgent();

    // Start interactive loop
    this.prompt();
  }

  private printBanner() {
    console.log(`
${colors.cyan}╔══════════════════════════════════════════════════════════════╗
║                                                                ║
║   ${colors.bright}Agent Core CLI${colors.reset}${colors.cyan} - Interactive Testing Tool                  ║
║                                                                ║
║   Commands:                                                    ║
║     task <description>  - Execute a task                       ║
║     stream <description> - Stream task execution               ║
║     config              - Show current config                  ║
║     set <key> <value>   - Update config                        ║
║     reset               - Reset agent state                    ║
║     help                - Show this help                       ║
║     exit                - Exit CLI                             ║
║                                                                ║
╚══════════════════════════════════════════════════════════════╝${colors.reset}
`);
  }

  private async initAgent() {
    log('[CLI]', colors.cyan, 'Initializing agent...');

    // Connect mock browser
    await this.browserAdapter.connect('mock://localhost:9222');

    // Create tools
    const tools = createBrowserTools(this.browserAdapter);
    log('[CLI]', colors.dim, `Created ${tools.length} browser tools`);

    // Create agent
    this.agent = new BrowserAgent({
      browserAdapter: this.browserAdapter,
      tools,
      llmConfig: {
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        model: 'claude-sonnet-4-5-20250929',
      },
      agentConfig: {
        maxIterations: 10,
        maxConsecutiveFailures: 3,
        enableScreenshots: false,
        enableRuleFallback: true,
      },
    });

    this.agent.compile();
    log('[CLI]', colors.green, 'Agent initialized successfully');
  }

  private prompt() {
    this.rl.question(`${colors.cyan}agent> ${colors.reset}`, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        this.prompt();
        return;
      }

      await this.handleCommand(trimmed);
      this.prompt();
    });
  }

  private async handleCommand(input: string) {
    const [command, ...args] = input.split(' ');
    const argString = args.join(' ');

    switch (command.toLowerCase()) {
      case 'task':
        await this.executeTask(argString);
        break;
      case 'stream':
        await this.streamTask(argString);
        break;
      case 'config':
        this.showConfig();
        break;
      case 'set':
        this.setConfig(args[0], args.slice(1).join(' '));
        break;
      case 'reset':
        await this.resetAgent();
        break;
      case 'help':
        this.printBanner();
        break;
      case 'exit':
      case 'quit':
        console.log('Goodbye!');
        process.exit(0);
        break;
      default:
        // Treat unknown commands as tasks
        await this.executeTask(input);
    }
  }

  private async executeTask(task: string) {
    if (!task) {
      console.log(`${colors.yellow}Usage: task <description>${colors.reset}`);
      return;
    }

    if (!this.agent) {
      console.log(`${colors.red}Agent not initialized${colors.reset}`);
      return;
    }

    console.log(`\n${colors.bgBlue}${colors.bright} EXECUTING TASK ${colors.reset}`);
    console.log(`${colors.blue}Task: ${colors.bright}${task}${colors.reset}\n`);

    try {
      const result = await this.agent.executeTask(task);
      
      console.log(`\n${colors.bgGreen}${colors.bright} TASK RESULT ${colors.reset}`);
      console.log(colors.green + '─'.repeat(60) + colors.reset);
      console.log(`  Status: ${result.status}`);
      console.log(`  Iterations: ${result.iterationCount}`);
      console.log(`  Actions: ${result.actionHistory?.length || 0}`);
      if (result.result) {
        console.log(`  Result: ${colors.bright}${result.result}${colors.reset}`);
      }
      if (result.error) {
        console.log(`  Error: ${colors.red}${result.error}${colors.reset}`);
      }
      console.log(colors.green + '─'.repeat(60) + colors.reset);

      // Show action history
      if (result.actionHistory && result.actionHistory.length > 0) {
        console.log(`\n${colors.cyan}Action History:${colors.reset}`);
        result.actionHistory.forEach((action, i) => {
          const status = action.result?.success ? colors.green + '✓' : colors.red + '✗';
          console.log(`  ${i + 1}. ${status}${colors.reset} ${action.tool}(${JSON.stringify(action.args)})`);
          if (action.thought) {
            console.log(`     ${colors.dim}Thought: ${action.thought}${colors.reset}`);
          }
        });
      }
    } catch (error) {
      console.log(`${colors.red}Error: ${error instanceof Error ? error.message : error}${colors.reset}`);
    }
  }

  private async streamTask(task: string) {
    if (!task) {
      console.log(`${colors.yellow}Usage: stream <description>${colors.reset}`);
      return;
    }

    if (!this.agent) {
      console.log(`${colors.red}Agent not initialized${colors.reset}`);
      return;
    }

    console.log(`\n${colors.bgBlue}${colors.bright} STREAMING TASK ${colors.reset}`);
    console.log(`${colors.blue}Task: ${colors.bright}${task}${colors.reset}\n`);

    try {
      for await (const event of this.agent.streamTask(task)) {
        const { node, state } = event;
        
        logNode(node, 'Processing...');
        logState(state);

        // Show action details if in act node
        if (node === 'act' && state.actionHistory) {
          const lastAction = state.actionHistory[state.actionHistory.length - 1];
          if (lastAction) {
            logAction(lastAction);
          }
        }

        // Show observation if in observe node
        if (node === 'observe' && state.observation) {
          console.log(`${colors.cyan}Observation:${colors.reset}`);
          console.log(`  URL: ${state.observation.url}`);
          console.log(`  Title: ${state.observation.title}`);
          console.log(`  Load State: ${state.observation.loadState}`);
        }
      }

      console.log(`\n${colors.bgGreen}${colors.bright} STREAM COMPLETE ${colors.reset}\n`);
    } catch (error) {
      console.log(`${colors.red}Error: ${error instanceof Error ? error.message : error}${colors.reset}`);
    }
  }

  private showConfig() {
    if (!this.agent) {
      console.log(`${colors.red}Agent not initialized${colors.reset}`);
      return;
    }

    const config = this.agent.getConfig();
    console.log(`\n${colors.cyan}Current Configuration:${colors.reset}`);
    console.log(JSON.stringify(config, null, 2));
  }

  private setConfig(key: string, value: string) {
    if (!this.agent || !key) {
      console.log(`${colors.yellow}Usage: set <key> <value>${colors.reset}`);
      return;
    }

    const numValue = Number(value);
    const boolValue = value === 'true' ? true : value === 'false' ? false : null;
    const finalValue = boolValue !== null ? boolValue : (!isNaN(numValue) ? numValue : value);

    this.agent.updateConfig({ [key]: finalValue } as Partial<AgentConfig>);
    console.log(`${colors.green}Set ${key} = ${finalValue}${colors.reset}`);
  }

  private async resetAgent() {
    log('[CLI]', colors.yellow, 'Resetting agent...');
    await this.initAgent();
    log('[CLI]', colors.green, 'Agent reset complete');
  }

  close() {
    this.rl.close();
  }
}

// ============================================
// Main Entry Point
// ============================================
async function main() {
  const cli = new AgentCLI();
  
  process.on('SIGINT', () => {
    console.log('\nGoodbye!');
    cli.close();
    process.exit(0);
  });

  await cli.start();
}

main().catch(console.error);

