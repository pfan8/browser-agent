#!/usr/bin/env tsx
/**
 * LangGraph Visualization Tool
 * 
 * Dynamically generates visual representations from the actual agent-core StateGraph.
 * 
 * Usage:
 *   pnpm tsx scripts/visualize-graph.ts [format]
 * 
 * Formats:
 *   mermaid  - Generate Mermaid diagram (default, can paste into mermaid.live)
 *   ascii    - Generate ASCII art representation
 *   png      - Generate PNG image (requires graphviz: brew install graphviz)
 *   json     - Output graph structure as JSON
 *   raw      - Output raw graph structure from LangGraph
 * 
 * Note: Requires packages to be built first (pnpm build:packages)
 */

import * as fs from 'fs';
import * as path from 'path';
// Import from compiled packages to avoid TypeScript module resolution issues
import { 
  DEFAULT_AGENT_CONFIG,
} from '@chat-agent/agent-core';


// ============================================
// Parse graph structure from source code
// ============================================

interface GraphNode {
  id: string;
  description: string;
}

interface GraphEdge {
  from: string;
  to: string;
  condition?: string;
  type: 'normal' | 'conditional';
}

interface GraphStructure {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Parse the graph.ts file to extract graph structure
 */
function parseGraphFromSource(): GraphStructure {
  const graphPath = path.join(__dirname, '..', 'packages', 'agent-core', 'src', 'graph.ts');
  const source = fs.readFileSync(graphPath, 'utf-8');
  
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  
  // Extract nodes using regex
  const nodeMatches = source.matchAll(/\.addNode\s*\(\s*["'](\w+)["']/g);
  for (const match of nodeMatches) {
    const nodeId = match[1];
    nodes.push({
      id: nodeId,
      description: getNodeDescription(nodeId),
    });
  }
  
  // Extract normal edges
  const edgeMatches = source.matchAll(/\.addEdge\s*\(\s*(\w+|["']\w+["'])\s*,\s*["'](\w+)["']\s*\)/g);
  for (const match of edgeMatches) {
    const from = match[1].replace(/["']/g, '');
    const to = match[2];
    edges.push({
      from: from === 'START' ? '__start__' : from,
      to: to === 'END' ? '__end__' : to,
      type: 'normal',
    });
  }
  
  // Extract conditional edges
  const conditionalMatches = source.matchAll(/\.addConditionalEdges\s*\(\s*["'](\w+)["']\s*,\s*[\w()\s=>.,]+,\s*\{([^}]+)\}/g);
  for (const match of conditionalMatches) {
    const from = match[1];
    const mappingStr = match[2];
    
    // Parse the mapping object
    const mappings = mappingStr.matchAll(/(\w+)\s*:\s*(?:["'](\w+)["']|(\w+))/g);
    for (const m of mappings) {
      const condition = m[1];
      const to = m[2] || m[3];
      edges.push({
        from,
        to: to === 'END' ? '__end__' : to,
        condition,
        type: 'conditional',
      });
    }
  }
  
  return { nodes, edges };
}

function getNodeDescription(nodeId: string): string {
  const descriptions: Record<string, string> = {
    planner: 'High-level task planning (LLM decides next step)',
    codeact: 'Code generation & execution (Playwright)',
    observe: 'Capture browser state',
    think: 'LLM reasoning',
    act: 'Execute action',
  };
  return descriptions[nodeId] || nodeId;
}


// ============================================
// Generate Mermaid Diagram (Dynamic)
// ============================================

function generateMermaid(): string {
  const structure = parseGraphFromSource();
  
  const nodeColors: Record<string, { fill: string; stroke: string }> = {
    planner: { fill: '#a855f7', stroke: '#9333ea' },
    codeact: { fill: '#22c55e', stroke: '#16a34a' },
    observe: { fill: '#06b6d4', stroke: '#0891b2' },
    think: { fill: '#a855f7', stroke: '#9333ea' },
    act: { fill: '#22c55e', stroke: '#16a34a' },
  };
  
  const nodeIcons: Record<string, string> = {
    planner: '🧠',
    codeact: '⚡',
    observe: '👁',
    think: '🧠',
    act: '⚡',
  };
  
  let diagram = `%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#4f46e5', 'primaryTextColor': '#fff', 'primaryBorderColor': '#4338ca', 'lineColor': '#6366f1', 'secondaryColor': '#f0abfc', 'tertiaryColor': '#c4b5fd'}}}%%
flowchart TD
    subgraph AgentLoop["🔄 Planner + CodeAct Loop"]
        START([▶ START])`;
  
  // Add nodes
  for (const node of structure.nodes) {
    const icon = nodeIcons[node.id] || '📦';
    diagram += `\n        ${node.id}["${icon} ${node.id.toUpperCase()}<br/><small>${node.description}</small>"]`;
  }
  
  diagram += `\n    end\n`;
  
  // Add edges
  const endNodes = new Set<number>();
  let endCounter = 1;
  
  for (const edge of structure.edges) {
    const from = edge.from === '__start__' ? 'START' : edge.from;
    let to = edge.to;
    
    if (to === '__end__') {
      const endId = `END${endCounter}`;
      endNodes.add(endCounter);
      endCounter++;
      to = endId;
    }
    
    if (edge.condition) {
      diagram += `\n    ${from} -->|"${edge.condition}"| ${to}`;
    } else {
      diagram += `\n    ${from} --> ${to}`;
    }
  }
  
  // Add END node definitions
  for (const n of endNodes) {
    diagram += `\n    END${n}([🏁 END])`;
  }
  
  // Add termination conditions box
  diagram += `\n
    subgraph Conditions["📋 Termination Conditions"]
        direction LR
        C1["isComplete = true"]
        C2["status = 'error'"]
        C3["maxIterations reached"]
    end`;
  
  // Add styles
  diagram += `\n
    style START fill:#6366f1,stroke:#4f46e5,color:#fff`;
  
  for (const node of structure.nodes) {
    const colors = nodeColors[node.id] || { fill: '#64748b', stroke: '#475569' };
    diagram += `\n    style ${node.id} fill:${colors.fill},stroke:${colors.stroke},color:#fff`;
  }
  
  for (const n of endNodes) {
    diagram += `\n    style END${n} fill:#ef4444,stroke:#dc2626,color:#fff`;
  }
  
  diagram += `\n    style AgentLoop fill:#f8fafc,stroke:#e2e8f0
    style Conditions fill:#fef3c7,stroke:#fcd34d`;
  
  return diagram;
}

// ============================================
// Generate ASCII Art (Dynamic)
// ============================================

function generateAscii(): string {
  const structure = parseGraphFromSource();
  
  const nodeList = structure.nodes.map(n => n.id).join(', ');
  const hasObserve = structure.nodes.some(n => n.id === 'observe');
  
  if (hasObserve) {
    // Old ReAct pattern
    return generateOldReActAscii();
  }
  
  // New Planner + CodeAct pattern
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                         Agent Core - LangGraph Flow                          ║
║                          (Planner + CodeAct Pattern)                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Nodes: ${nodeList}
  
                                  ┌─────────┐
                                  │  START  │
                                  └────┬────┘
                                       │
                                       ▼
                            ╔═══════════════════╗
                            ║     PLANNER       ║
                            ║  ─────────────    ║
                            ║  • Task planning  ║
                            ║  • Next step      ║
                            ║  • Completion     ║
                            ╚════════╤══════════╝
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
              [isComplete]     [has instruction]  [error]
                    │                │                │
                    ▼                │                ▼
              ┌─────────┐            │          ┌─────────┐
              │   END   │            │          │   END   │
              └─────────┘            │          └─────────┘
                                     ▼
                          ╔═══════════════════╗
                          ║     CODEACT       ║
                          ║  ─────────────    ║
                          ║  • Code generate  ║
                          ║  • Execute code   ║
                          ║  • Return result  ║
                          ╚════════╤══════════╝
                                   │
                                   │
                                   └──────────────────┐
                                                      │
                                                      ▼
                                            [back to PLANNER]
                                                      │
                                                      │
                           ┌──────────────────────────┘
                           │
                           ▼
                  ╔═══════════════════╗
                  ║     PLANNER       ║ (next iteration)
                  ╚═══════════════════╝

╔══════════════════════════════════════════════════════════════════════════════╗
║                          Termination Conditions                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  • isComplete = true (goal achieved by planner)                              ║
║  • status = 'error' (unrecoverable error)                                    ║
║  • No instruction from planner                                               ║
║  • maxIterations reached (in executeTask)                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;
}

function generateOldReActAscii(): string {
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                         Agent Core - LangGraph Flow                          ║
║                              (ReAct Pattern)                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝

                                  ┌─────────┐
                                  │  START  │
                                  └────┬────┘
                                       │
                                       ▼
                            ╔═══════════════════╗
                            ║     OBSERVE       ║
                            ╚═════════╤═════════╝
                                      │
                                      ▼
                            ╔═══════════════════╗
                            ║      THINK        ║
                            ╚═════════╤═════════╝
                                      │
                                      ▼
                            ╔═══════════════════╗
                            ║       ACT         ║
                            ╚═════════╤═════════╝
                                      │
                                      └────────────────────────────────────────┐
                                                                               │
                                                                               ▼
                                                                         [back to OBSERVE]
`;
}

// ============================================
// Generate JSON Structure (Dynamic)
// ============================================

function generateJson(): string {
  const structure = parseGraphFromSource();
  
  const result = {
    name: "BrowserAgent Graph",
    description: "Dynamically extracted from packages/agent-core/src/graph.ts",
    architecture: structure.nodes.some(n => n.id === 'planner') 
      ? "Planner + CodeAct" 
      : "ReAct (Observe + Think + Act)",
    nodes: structure.nodes.map(n => ({
      id: n.id,
      name: `${n.id.charAt(0).toUpperCase()}${n.id.slice(1)} Node`,
      description: n.description,
    })),
    edges: structure.edges.map(e => ({
      from: e.from,
      to: e.to,
      type: e.type,
      condition: e.condition || null,
    })),
    terminationConditions: [
      "isComplete = true",
      "status = 'error'",
      "maxIterations reached",
    ],
    sourceFile: "packages/agent-core/src/graph.ts",
    extractedAt: new Date().toISOString(),
    defaultConfig: DEFAULT_AGENT_CONFIG,
  };
  
  return JSON.stringify(result, null, 2);
}

// ============================================
// Generate Raw Graph Structure
// ============================================

function generateRaw(): string {
  const structure = parseGraphFromSource();
  
  return `
=== Parsed Graph Structure ===

Source File: packages/agent-core/src/graph.ts

Nodes (${structure.nodes.length}):
${structure.nodes.map(n => `  - ${n.id}: ${n.description}`).join('\n')}

Edges (${structure.edges.length}):
${structure.edges.map(e => {
  const arrow = e.type === 'conditional' ? `--[${e.condition}]-->` : '--->';
  return `  ${e.from} ${arrow} ${e.to}`;
}).join('\n')}

=== JSON ===
${JSON.stringify(structure, null, 2)}
`;
}

// ============================================
// Generate PNG
// ============================================

async function generatePng(outputPath: string): Promise<void> {
  // PNG generation would require external tools like mermaid-cli
  // For now, just save the mermaid file and provide instructions
  const mermaid = generateMermaid();
  const mermaidPath = outputPath.replace('.png', '.mmd');
  fs.writeFileSync(mermaidPath, mermaid);
  
  console.log(`📝 Mermaid file saved to: ${mermaidPath}`);
  console.log(`\nTo generate PNG, use one of these methods:`);
  console.log(`\n1. Online: Paste the Mermaid code at https://mermaid.live and export`);
  console.log(`\n2. CLI (requires mermaid-cli): npx -p @mermaid-js/mermaid-cli mmdc -i ${mermaidPath} -o ${outputPath}`);
  console.log(`\n3. VS Code: Install "Markdown Preview Mermaid Support" extension`);
}

// ============================================
// Main
// ============================================

async function main() {
  const format = process.argv[2] || 'mermaid';
  const outputDir = path.join(__dirname, '..', 'docs');
  
  console.log(`\n🔍 LangGraph Visualization Tool (Dynamic)\n`);
  
  // Show parsed structure
  const structure = parseGraphFromSource();
  console.log(`📊 Detected graph structure:`);
  console.log(`   Nodes: ${structure.nodes.map(n => n.id).join(', ')}`);
  console.log(`   Edges: ${structure.edges.length} total`);
  console.log('');
  
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
      
    case 'raw':
      const raw = generateRaw();
      console.log(raw);
      break;
      
    case 'png':
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const pngPath = path.join(outputDir, 'agent-graph.png');
      await generatePng(pngPath);
      break;
      
    default:
      console.log('Unknown format. Available formats: mermaid, ascii, json, raw, png');
  }
}

main().catch(console.error);
