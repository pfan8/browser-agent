# Chat Browser Agent

Interactive chat agent desktop application for browser automation with operation recording and Playwright script generation.

## Features

- **Chat Interface**: Control your browser through natural language or predefined commands
- **CDP Connection**: Connect to any Chrome/Edge browser via Chrome DevTools Protocol
- **Operation Recording**: All browser operations are recorded as a custom DSL
- **Script Generation**: Export recorded operations as Playwright test scripts
- **LLM Integration**: Optional Claude API integration for natural language understanding

## Prerequisites

1. Node.js 18+ and pnpm
2. Chrome or Edge browser started with remote debugging enabled

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Chrome with Debug Mode

Start Chrome/Edge with remote debugging enabled:

```bash
# macOS Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# macOS Edge  
/Applications/Microsoft\ Edge.app/Contents/MacOS/Microsoft\ Edge --remote-debugging-port=9222

# Or use the existing script from parent directory
../start-chrome-debug.sh
```

### 3. Run the App

Development mode:
```bash
pnpm electron:dev
```

Build for production:
```bash
pnpm build
```

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `connect [url]` | Connect to browser via CDP | `connect http://localhost:9222` |
| `disconnect` | Disconnect from browser | `disconnect` |
| `goto <url>` | Navigate to URL | `goto https://google.com` |
| `click <selector>` | Click an element | `click #submit-btn` |
| `type <selector> <text>` | Type into an input | `type #search "hello world"` |
| `screenshot [name]` | Take a screenshot | `screenshot my-page` |
| `wait <ms>` | Wait for milliseconds | `wait 2000` |
| `export` | Generate Playwright script | `export` |
| `clear` | Clear recorded operations | `clear` |
| `status` | Show current status | `status` |
| `help` | Show help message | `help` |

## Natural Language Support

With an Anthropic API key configured, you can use natural language commands:

- "Click the login button"
- "Fill in the email field with test@example.com"
- "Wait for the page to load"
- "Take a screenshot of the homepage"

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

## Architecture

```
chat-agent/
├── electron/           # Electron main process
│   ├── main.ts         # App entry point
│   ├── preload.ts      # IPC bridge
│   ├── browser-controller.ts  # Playwright CDP
│   ├── operation-recorder.ts  # DSL recording
│   ├── llm-service.ts  # LLM integration
│   └── script-generator.ts    # Playwright codegen
├── src/                # React renderer
│   ├── components/     # UI components
│   ├── hooks/          # React hooks
│   └── styles/         # CSS styles
├── dsl/                # DSL type definitions
└── recordings/         # Saved recordings
```

## License

MIT

