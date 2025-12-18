/**
 * DSL Type Definitions for Browser Agent Operations
 * 
 * This DSL is designed to capture browser automation operations in a format
 * that can be easily replayed and converted to Playwright scripts.
 */

// Operation Types
export type OperationType = 
  | 'navigate'
  | 'click'
  | 'type'
  | 'screenshot'
  | 'wait'
  | 'scroll'
  | 'hover'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'focus'
  | 'press'
  | 'evaluate';

// Selector Strategy
export type SelectorStrategy = 
  | 'css'
  | 'xpath'
  | 'text'
  | 'role'
  | 'testid'
  | 'label'
  | 'placeholder';

// Wait Until options for navigation
export type WaitUntilOption = 
  | 'load'
  | 'domcontentloaded'
  | 'networkidle'
  | 'commit';

// Base Operation interface
export interface BaseOperation {
  id: string;
  type: OperationType;
  timestamp: string;
  description?: string;
}

// Navigate Operation
export interface NavigateOperation extends BaseOperation {
  type: 'navigate';
  url: string;
  waitUntil?: WaitUntilOption;
}

// Click Operation
export interface ClickOperation extends BaseOperation {
  type: 'click';
  selector: string;
  selectorStrategy: SelectorStrategy;
  alternatives?: string[];
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
}

// Type Operation
export interface TypeOperation extends BaseOperation {
  type: 'type';
  selector: string;
  selectorStrategy: SelectorStrategy;
  alternatives?: string[];
  text: string;
  delay?: number;
  clear?: boolean;
}

// Screenshot Operation
export interface ScreenshotOperation extends BaseOperation {
  type: 'screenshot';
  name?: string;
  fullPage?: boolean;
  selector?: string;
  path?: string;
}

// Wait Operation
export interface WaitOperation extends BaseOperation {
  type: 'wait';
  duration?: number;
  selector?: string;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  url?: string;
  timeout?: number;
}

// Scroll Operation
export interface ScrollOperation extends BaseOperation {
  type: 'scroll';
  selector?: string;
  x?: number;
  y?: number;
  behavior?: 'auto' | 'smooth';
}

// Hover Operation
export interface HoverOperation extends BaseOperation {
  type: 'hover';
  selector: string;
  selectorStrategy: SelectorStrategy;
  alternatives?: string[];
}

// Select Operation (for dropdowns)
export interface SelectOperation extends BaseOperation {
  type: 'select';
  selector: string;
  selectorStrategy: SelectorStrategy;
  alternatives?: string[];
  value?: string;
  label?: string;
  index?: number;
}

// Check/Uncheck Operation (for checkboxes)
export interface CheckOperation extends BaseOperation {
  type: 'check' | 'uncheck';
  selector: string;
  selectorStrategy: SelectorStrategy;
  alternatives?: string[];
}

// Focus Operation
export interface FocusOperation extends BaseOperation {
  type: 'focus';
  selector: string;
  selectorStrategy: SelectorStrategy;
  alternatives?: string[];
}

// Press Operation (keyboard)
export interface PressOperation extends BaseOperation {
  type: 'press';
  key: string;
  selector?: string;
  modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
}

// Evaluate Operation (run JS)
export interface EvaluateOperation extends BaseOperation {
  type: 'evaluate';
  script: string;
  args?: unknown[];
}

// Union type for all operations
export type Operation = 
  | NavigateOperation
  | ClickOperation
  | TypeOperation
  | ScreenshotOperation
  | WaitOperation
  | ScrollOperation
  | HoverOperation
  | SelectOperation
  | CheckOperation
  | FocusOperation
  | PressOperation
  | EvaluateOperation;

// Recording metadata
export interface RecordingMetadata {
  name?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  browserInfo?: {
    name: string;
    version: string;
  };
  viewportSize?: {
    width: number;
    height: number;
  };
}

// Complete Recording structure
export interface Recording {
  version: string;
  metadata: RecordingMetadata;
  operations: Operation[];
}

// Command Parsing Result
export interface ParsedCommand {
  type: 'predefined' | 'natural';
  command: string;
  args: Record<string, string | number | boolean>;
  confidence: number;
  rawInput: string;
}

// Predefined Commands
export interface PredefinedCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  args: {
    name: string;
    type: 'string' | 'number' | 'boolean';
    required: boolean;
    description: string;
  }[];
}

// Predefined command definitions
export const PREDEFINED_COMMANDS: PredefinedCommand[] = [
  {
    name: 'goto',
    aliases: ['navigate', 'open', 'visit'],
    description: 'Navigate to a URL',
    usage: 'goto <url>',
    args: [
      { name: 'url', type: 'string', required: true, description: 'The URL to navigate to' }
    ]
  },
  {
    name: 'click',
    aliases: ['press', 'tap'],
    description: 'Click on an element',
    usage: 'click <selector>',
    args: [
      { name: 'selector', type: 'string', required: true, description: 'CSS selector or element description' }
    ]
  },
  {
    name: 'type',
    aliases: ['input', 'fill', 'enter'],
    description: 'Type text into an input field',
    usage: 'type <selector> <text>',
    args: [
      { name: 'selector', type: 'string', required: true, description: 'CSS selector of the input' },
      { name: 'text', type: 'string', required: true, description: 'Text to type' }
    ]
  },
  {
    name: 'screenshot',
    aliases: ['capture', 'snap'],
    description: 'Take a screenshot',
    usage: 'screenshot [name]',
    args: [
      { name: 'name', type: 'string', required: false, description: 'Screenshot filename' }
    ]
  },
  {
    name: 'wait',
    aliases: ['delay', 'pause', 'sleep'],
    description: 'Wait for specified milliseconds',
    usage: 'wait <ms>',
    args: [
      { name: 'ms', type: 'number', required: true, description: 'Milliseconds to wait' }
    ]
  },
  {
    name: 'scroll',
    aliases: ['scrollto'],
    description: 'Scroll the page or element',
    usage: 'scroll [selector] [x] [y]',
    args: [
      { name: 'selector', type: 'string', required: false, description: 'Element to scroll (or page)' },
      { name: 'y', type: 'number', required: false, description: 'Vertical scroll amount' }
    ]
  },
  {
    name: 'hover',
    aliases: ['mouseover'],
    description: 'Hover over an element',
    usage: 'hover <selector>',
    args: [
      { name: 'selector', type: 'string', required: true, description: 'CSS selector to hover' }
    ]
  },
  {
    name: 'select',
    aliases: ['choose', 'pick'],
    description: 'Select an option from dropdown',
    usage: 'select <selector> <value>',
    args: [
      { name: 'selector', type: 'string', required: true, description: 'Dropdown selector' },
      { name: 'value', type: 'string', required: true, description: 'Option value or label' }
    ]
  },
  {
    name: 'press',
    aliases: ['key'],
    description: 'Press a keyboard key',
    usage: 'press <key>',
    args: [
      { name: 'key', type: 'string', required: true, description: 'Key to press (e.g., Enter, Tab)' }
    ]
  },
  {
    name: 'export',
    aliases: ['generate', 'save'],
    description: 'Export recording to Playwright script',
    usage: 'export',
    args: []
  },
  {
    name: 'clear',
    aliases: ['reset'],
    description: 'Clear all recorded operations',
    usage: 'clear',
    args: []
  },
  {
    name: 'connect',
    aliases: ['attach'],
    description: 'Connect to browser via CDP',
    usage: 'connect [url]',
    args: [
      { name: 'url', type: 'string', required: false, description: 'CDP endpoint URL (default: http://localhost:9222)' }
    ]
  },
  {
    name: 'disconnect',
    aliases: ['detach'],
    description: 'Disconnect from browser',
    usage: 'disconnect',
    args: []
  },
  {
    name: 'status',
    aliases: ['info'],
    description: 'Show current browser and recording status',
    usage: 'status',
    args: []
  }
];

// Execution step for agent think/act process
export interface ExecutionStep {
  id: string;
  type: 'planner' | 'codeact' | 'observe';
  timestamp: string;
  content: string;
  tool?: string;
  status: 'pending' | 'running' | 'success' | 'error';
  error?: string;
  duration?: number; // milliseconds
  // Enhanced fields for streaming display
  thought?: string;      // Planner's thinking/reasoning
  instruction?: string;  // Instruction to execute
  code?: string;         // Generated code (for codeact)
  observation?: {        // Page state (for observe)
    url?: string;
    title?: string;
  };
}

// Message types for chat
export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
  status?: 'pending' | 'success' | 'error' | 'processing';
  operation?: Operation;
  error?: string;
  thinking?: string; // Collapsible thinking/interpretation section
  type?: 'command' | 'task' | 'chat' | 'status'; // Message type for hierarchical agent
  executionSteps?: ExecutionStep[]; // Collapsible execution steps (think/act)
}

// Agent State
export interface AgentState {
  isConnected: boolean;
  isProcessing: boolean;
  currentUrl?: string;
  pageTitle?: string;
  recording: Recording;
  messages: ChatMessage[];
}

// Browser Event types
export interface BrowserEvent {
  type: 'navigation' | 'load' | 'error' | 'console' | 'dialog';
  data: unknown;
  timestamp: string;
}

// Export helper to create new recording
export function createNewRecording(): Recording {
  return {
    version: '1.0',
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    operations: []
  };
}

// Export helper to generate operation ID
export function generateOperationId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

