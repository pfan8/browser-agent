#!/usr/bin/env tsx
/**
 * LangGraph Visualization Tool
 * 
 * Generates visual representations of the agent-core StateGraph.
 * 
 * Usage:
 *   pnpm tsx scripts/visualize-graph.ts [format]
 * 
 * Formats:
 *   mermaid  - Generate Mermaid diagram (default, can paste into mermaid.live)
 *   ascii    - Generate ASCII art representation
 *   png      - Generate PNG image (requires graphviz: brew install graphviz)
 *   json     - Output graph structure as JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import { StateGraph, START, END } from '@langchain/langgraph';
import { 
  AgentStateAnnotation,
  type AgentState,
  type AgentConfig,
  DEFAULT_AGENT_CONFIG,
} from '../packages/agent-core/src/state';

// ============================================
// Recreate the graph structure for visualization
// (We can't use the actual nodes as they require browser adapter)
// ============================================

function createVisualizationGraph() {
  // Create a simplified graph with the same structure as the real agent
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("observe", async (state: AgentState) => ({ status: 'observing' as const }))
    .addNode("think", async (state: AgentState) => ({ status: 'thinking' as const }))
    .addNode("act", async (state: AgentState) => ({ status: 'acting' as const }))
    .addEdge(START, "observe")
    .addConditionalEdges("observe", (state) => {
      if (state.status === 'error') return 'end';
      if (state.isComplete) return 'end';
      if (state.loopDetected) return 'end';
      return 'think';
    }, {
      think: "think",
      end: END,
    })
    .addConditionalEdges("think", (state) => {
      if (state.status === 'error') return 'end';
      if (state.isComplete) return 'end';
      if (state.loopDetected) return 'end';
      const latestAction = state.actionHistory[state.actionHistory.length - 1];
      if (!latestAction || latestAction.result) return 'observe';
      return 'act';
    }, {
      act: "act",
      observe: "observe",
      end: END,
    })
    .addConditionalEdges("act", (state) => {
      if (state.status === 'error') return 'end';
      if (state.isComplete) return 'end';
      if (state.loopDetected) return 'end';
      return 'observe';
    }, {
      observe: "observe",
      end: END,
    });

  return graph;
}

// ============================================
// Generate Mermaid Diagram
// ============================================
function generateMermaid(): string {
  // Custom Mermaid diagram that better represents the ReAct loop
  return `%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#4f46e5', 'primaryTextColor': '#fff', 'primaryBorderColor': '#4338ca', 'lineColor': '#6366f1', 'secondaryColor': '#f0abfc', 'tertiaryColor': '#c4b5fd'}}}%%
flowchart TD
    subgraph ReAct["🔄 ReAct Loop"]
        START([▶ START]) --> observe
        
        observe["👁 OBSERVE<br/><small>Capture browser state</small><br/><small>• URL, Title, Content</small><br/><small>• Load state (SA-01)</small><br/><small>• Content hash (SA-06)</small>"]
        
        think["🧠 THINK<br/><small>LLM reasoning</small><br/><small>• Analyze observation</small><br/><small>• Plan next action</small><br/><small>• Rule fallback (RA-08)</small>"]
        
        act["⚡ ACT<br/><small>Execute action</small><br/><small>• Browser tools</small><br/><small>• Retry logic (ER-02)</small><br/><small>• Selector fallback (ER-01)</small>"]
    end
    
    observe -->|"continue"| think
    observe -->|"error/complete/loop"| END1([🏁 END])
    
    think -->|"has action"| act
    think -->|"no action needed"| observe
    think -->|"error/complete/loop"| END2([🏁 END])
    
    act -->|"continue"| observe
    act -->|"error/complete/loop"| END3([🏁 END])
    
    subgraph Conditions["📋 Termination Conditions"]
        direction LR
        C1["RA-05: isComplete = true"]
        C2["RA-05: maxIterations reached"]
        C3["RA-06: loopDetected = true"]
        C4["RA-07: maxConsecutiveFailures"]
        C5["status = 'error'"]
    end
    
    style observe fill:#06b6d4,stroke:#0891b2,color:#fff
    style think fill:#a855f7,stroke:#9333ea,color:#fff
    style act fill:#22c55e,stroke:#16a34a,color:#fff
    style START fill:#6366f1,stroke:#4f46e5,color:#fff
    style END1 fill:#ef4444,stroke:#dc2626,color:#fff
    style END2 fill:#ef4444,stroke:#dc2626,color:#fff
    style END3 fill:#ef4444,stroke:#dc2626,color:#fff
    style ReAct fill:#f8fafc,stroke:#e2e8f0
    style Conditions fill:#fef3c7,stroke:#fcd34d`;
}

// ============================================
// Generate ASCII Art
// ============================================
function generateAscii(): string {
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                         Agent Core - LangGraph Flow                          ║
║                              (ReAct Pattern)                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝

                                  ┌─────────┐
                                  │  START  │
                                  └────┬────┘
                                       │
                                       ▼
                            ╔═══════════════════╗
                            ║     OBSERVE       ║
                            ║  ─────────────    ║
                            ║  • Get page info  ║
                            ║  • Capture state  ║
                            ║  • Detect changes ║
                            ╚═════════╤═════════╝
                                      │
                   ┌──────────────────┼──────────────────┐
                   │                  │                  │
                   ▼                  ▼                  ▼
             [isComplete]       [loopDetected]      [continue]
             [error]            [maxIterations]         │
                   │                  │                 │
                   └────────┬─────────┘                 │
                            │                           ▼
                            │                ╔═══════════════════╗
                            │                ║      THINK        ║
                            │                ║  ─────────────    ║
                            │                ║  • LLM reasoning  ║
                            │                ║  • Choose action  ║
                            │                ║  • Rule fallback  ║
                            │                ╚═════════╤═════════╝
                            │                          │
                            │     ┌────────────────────┼────────────────────┐
                            │     │                    │                    │
                            │     ▼                    ▼                    ▼
                            │ [has action]      [no action]           [complete]
                            │     │                    │              [error]
                            │     │                    │                    │
                            │     ▼                    │                    │
                            │ ╔═══════════════════╗    │                    │
                            │ ║       ACT         ║    │                    │
                            │ ║  ─────────────    ║    │                    │
                            │ ║  • Execute tool   ║    │                    │
                            │ ║  • Retry logic    ║    │                    │
                            │ ║  • Verify result  ║    │                    │
                            │ ╚═════════╤═════════╝    │                    │
                            │           │              │                    │
                            │           │              │                    │
                            │           └──────────────┘                    │
                            │                  │                            │
                            │                  ▼                            │
                            │          [back to OBSERVE]                    │
                            │                  │                            │
                            │                  │                            │
                            │                  └────────────────────────────┤
                            │                                               │
                            ▼                                               ▼
                       ┌─────────┐                                    ┌─────────┐
                       │   END   │                                    │   END   │
                       └─────────┘                                    └─────────┘

╔══════════════════════════════════════════════════════════════════════════════╗
║                          Termination Conditions                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  RA-05: isComplete = true (goal achieved)                                    ║
║  RA-05: iterationCount >= maxIterations (default: 20)                        ║
║  RA-06: loopDetected = true (repeated actions)                               ║
║  RA-07: consecutiveFailures >= maxConsecutiveFailures (default: 3)           ║
║  status = 'error' (unrecoverable error)                                      ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;
}

// ============================================
// Generate JSON Structure
// ============================================
function generateJson(): string {
  const structure = {
    name: "BrowserAgent ReAct Graph",
    nodes: [
      {
        id: "observe",
        name: "Observe Node",
        description: "Captures current browser state (RA-01)",
        inputs: ["goal", "previousObservation"],
        outputs: ["observation", "iterationCount", "loadState"],
        features: ["SA-01: Page load detection", "SA-04: Loading/modal detection", "SA-06: Content change detection"]
      },
      {
        id: "think", 
        name: "Think Node",
        description: "LLM reasoning to decide next action (RA-02)",
        inputs: ["goal", "observation", "actionHistory"],
        outputs: ["actionHistory", "isComplete", "loopDetected"],
        features: ["RA-06: Loop detection", "RA-08: Rule-based fallback", "SA-05: Context preservation"]
      },
      {
        id: "act",
        name: "Act Node", 
        description: "Executes browser actions (RA-03)",
        inputs: ["actionHistory"],
        outputs: ["actionHistory", "consecutiveFailures", "completedSteps"],
        features: ["ER-01: Selector fallback", "ER-02: Retry with backoff", "SA-02: Result verification"]
      }
    ],
    edges: [
      { from: "__start__", to: "observe", label: "initial" },
      { from: "observe", to: "think", condition: "continue" },
      { from: "observe", to: "__end__", condition: "error | complete | loop" },
      { from: "think", to: "act", condition: "has pending action" },
      { from: "think", to: "observe", condition: "no action needed" },
      { from: "think", to: "__end__", condition: "error | complete | loop" },
      { from: "act", to: "observe", condition: "continue" },
      { from: "act", to: "__end__", condition: "error | complete | loop | maxIterations | maxFailures" }
    ],
    terminationConditions: [
      "RA-05: isComplete = true",
      "RA-05: iterationCount >= maxIterations",
      "RA-06: loopDetected = true",
      "RA-07: consecutiveFailures >= maxConsecutiveFailures",
      "status = 'error'"
    ],
    defaultConfig: DEFAULT_AGENT_CONFIG
  };
  
  return JSON.stringify(structure, null, 2);
}

// ============================================
// Generate PNG using LangGraph's built-in method
// ============================================
async function generatePng(outputPath: string): Promise<void> {
  try {
    const graph = createVisualizationGraph();
    const compiled = graph.compile();
    
    // Get the drawable graph
    const drawable = compiled.getGraph();
    
    // Try to draw PNG (requires graphviz)
    const png = await drawable.drawMermaidPng();
    fs.writeFileSync(outputPath, Buffer.from(await png.arrayBuffer()));
    console.log(`PNG saved to: ${outputPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('graphviz')) {
      console.error('Error: graphviz is required for PNG generation.');
      console.error('Install with: brew install graphviz');
    } else {
      throw error;
    }
  }
}

// ============================================
// Main
// ============================================
async function main() {
  const format = process.argv[2] || 'mermaid';
  const outputDir = path.join(__dirname, '..', 'docs');
  
  console.log(`\n🔍 LangGraph Visualization Tool\n`);
  
  switch (format.toLowerCase()) {
    case 'mermaid':
      const mermaid = generateMermaid();
      console.log('📊 Mermaid Diagram:\n');
      console.log('Copy the following to https://mermaid.live or any Mermaid viewer:\n');
      console.log('```mermaid');
      console.log(mermaid);
      console.log('```\n');
      
      // Also save to file
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const mermaidPath = path.join(outputDir, 'agent-graph.mmd');
      fs.writeFileSync(mermaidPath, mermaid);
      console.log(`💾 Saved to: ${mermaidPath}`);
      break;
      
    case 'ascii':
      const ascii = generateAscii();
      console.log(ascii);
      break;
      
    case 'json':
      const json = generateJson();
      console.log(json);
      
      // Also save to file
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const jsonPath = path.join(outputDir, 'agent-graph.json');
      fs.writeFileSync(jsonPath, json);
      console.log(`\n💾 Saved to: ${jsonPath}`);
      break;
      
    case 'png':
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const pngPath = path.join(outputDir, 'agent-graph.png');
      await generatePng(pngPath);
      break;
      
    default:
      console.log('Unknown format. Available formats: mermaid, ascii, json, png');
  }
}

main().catch(console.error);

