# Chat Browser Agent

Interactive chat agent desktop application for browser automation with operation recording and Playwright script generation.

## Features

- **Chat Interface**: Control your browser through natural language
- **CDP Connection**: Connect to any Chrome/Edge browser via Chrome DevTools Protocol
- **LangGraph Agent**: AI-powered browser automation using LangGraph ReAct pattern
- **Operation Recording**: All browser operations are recorded as a custom DSL
- **Script Generation**: Export recorded operations as Playwright test scripts
- **LLM Integration**: Claude API integration for intelligent task planning

## Architecture Overview

The project uses a **technical layering architecture** that separates concerns and enables independent testing:

```
┌─────────────────────────────────────────────────────────┐
│              Electron Integration Layer                  │
│   - electron/main.ts (IPC handlers, app lifecycle)      │
│   - electron/preload.ts (secure API bridge)             │
│   - src/ (React UI components)                          │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              Agent Layer (LangGraph)                     │
│   packages/agent-core/                                   │
│   - StateGraph with ReAct pattern                       │
│   - observe → think → act → observe loop                │
│   - LangGraph MemorySaver for checkpoints               │
│   - Can be tested in pure Node.js (no Electron)         │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              Browser Adapter Layer                       │
│   packages/browser-adapter/                              │
│   - IBrowserAdapter interface                           │
│   - PlaywrightAdapter implementation                    │
│   - Can be tested with Chrome CDP (no Electron)         │
└─────────────────────────────────────────────────────────┘
```

### Package Structure

```
chat-agent/
├── packages/
│   ├── browser-adapter/     # Standalone browser control
│   │   ├── src/
│   │   │   ├── types.ts              # IBrowserAdapter interface
│   │   │   ├── playwright-adapter.ts # Playwright CDP implementation
│   │   │   └── index.ts
│   │   └── __tests__/
│   │
│   └── agent-core/          # LangGraph agent
│       ├── src/
│       │   ├── state.ts              # Agent state annotation
│       │   ├── graph.ts              # StateGraph & BrowserAgent class
│       │   ├── nodes/                # observe, think, act nodes
│       │   ├── tools/                # LangGraph tools
│       │   ├── checkpointer.ts       # Persistence config
│       │   └── index.ts
│       └── __tests__/
│
├── electron/                # Electron integration
│   ├── main.ts              # App entry, IPC handlers
│   ├── preload.ts           # Secure API bridge
│   ├── operation-recorder.ts
│   ├── script-generator.ts
│   ├── settings-store.ts
│   └── utils/
│
├── src/                     # React renderer
│   ├── components/          # UI components
│   ├── hooks/               # React hooks (useReActAgent)
│   └── styles/
│
├── dsl/                     # DSL type definitions
└── recordings/              # Saved recordings & screenshots
```

## Key Design Principles

1. **Dependency Inversion**: Agent depends on `IBrowserAdapter` interface, not concrete implementation
2. **Testability**: Core packages can be tested without Electron environment
3. **Separation of Concerns**: Each layer has a single responsibility
4. **Delayed Electron Integration**: Electron-specific code is only in `electron/` directory

## Prerequisites

1. Node.js 18+ and pnpm
2. Chrome or Edge browser started with remote debugging enabled

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Build Packages

```bash
cd packages/browser-adapter && pnpm build
cd ../agent-core && pnpm build
```

### 3. Start Chrome with Debug Mode

```bash
# macOS Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# macOS Edge  
/Applications/Microsoft\ Edge.app/Contents/MacOS/Microsoft\ Edge --remote-debugging-port=9222
```

### 4. Run the App

Development mode:
```bash
pnpm dev
```

Build for production:
```bash
pnpm build
```

## Testing

### Unit Tests (No Browser Required)
```bash
# Browser adapter tests
cd packages/browser-adapter && pnpm test

# Agent core tests (uses mock adapter)
cd packages/agent-core && pnpm test
```

### Integration Tests (Requires Chrome CDP)
```bash
# Start Chrome with --remote-debugging-port=9222 first
pnpm test
```

### E2E Tests (Full Electron App)
```bash
pnpm test:e2e
```

## Agent Development

The agent uses LangGraph's ReAct pattern:

1. **Observe**: Capture current browser state (URL, title, page content)
2. **Think**: LLM decides next action based on goal and observation
3. **Act**: Execute the decided tool (navigate, click, type, etc.)
4. **Loop**: Return to observe until goal is complete or max iterations reached

### Available Tools

| Tool | Description |
|------|-------------|
| `navigate` | Navigate to a URL |
| `click` | Click on an element |
| `type` | Type text into an input |
| `press` | Press a keyboard key |
| `hover` | Hover over an element |
| `select` | Select dropdown option |
| `wait` | Wait for duration |
| `waitForSelector` | Wait for element |
| `screenshot` | Take a screenshot |
| `getPageInfo` | Get current page info |
| `listPages` | List open tabs |
| `switchToPage` | Switch to a tab |
| `runCode` | Execute custom Playwright code |

## DSL Format

Operations are recorded in a JSON-based DSL format:

```json
{
  "version": "1.0",
  "metadata": {
    "createdAt": "2025-12-08T...",
    "updatedAt": "2025-12-08T..."
  },
  "operations": [
    {
      "id": "op_001",
      "type": "navigate",
      "url": "https://example.com",
      "timestamp": "2025-12-08T..."
    }
  ]
}
```

## License

MIT
