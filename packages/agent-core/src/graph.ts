/**
 * Agent Graph
 *
 * Main LangGraph StateGraph definition for the browser automation agent.
 * Uses a simple two-layer architecture:
 * - Planner: High-level task planning (doesn't know Playwright)
 * - CodeAct: Code generation and execution (knows Playwright API)
 *
 * Flow: START → planner → codeact → planner → codeact → ... → end
 * CodeAct returns execution results directly to Planner.
 *
 * The BrowserAgent class has been extracted to browser-agent.ts
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import {
    AgentStateAnnotation,
    type AgentState,
    type AgentConfig,
    DEFAULT_AGENT_CONFIG,
} from './state';
import {
    createPlannerNode,
    createBeadsPlannerNode,
    type PlannerNodeConfig,
} from './planner';
import { createCodeActNode, type CodeActNodeConfig } from './codeact';
import { createRouterNode } from './router';
import { type IBeadsClient } from './beads';
import { createSubAgentRegistry, createCodeActSubAgent } from './sub-agents';
import { createAgentLogger } from './tracing';

// Create module logger for the graph
const log = createAgentLogger('Graph');

/**
 * Configuration for the agent graph
 */
export interface AgentGraphConfig {
    browserAdapter: IBrowserAdapter;
    llmConfig: PlannerNodeConfig & CodeActNodeConfig;
    agentConfig?: Partial<AgentConfig>;
    /** Path to memory database (enables long-term memory) */
    memoryDbPath?: string;
}

/**
 * Configuration for the Beads-enabled agent graph
 */
export interface BeadsAgentGraphConfig extends AgentGraphConfig {
    /** Beads client for task management */
    beadsClient: IBeadsClient;
    /** Workspace path for Beads operations */
    workspacePath?: string;
}

/**
 * Route function after planner node
 *
 * Planner decides the next action:
 * 1. Give next instruction → go to codeact
 * 2. Complete task → end
 */
function routeAfterPlanner(state: AgentState): string {
    if (state.status === 'error') {
        return 'end';
    }
    if (state.isComplete) {
        return 'end';
    }
    // If planner decided next step, go to codeact
    if ((state as any).currentInstruction) {
        return 'codeact';
    }
    // No instruction - this shouldn't happen, end with error
    log.warn('Planner returned no instruction');
    return 'end';
}

/**
 * Creates the agent graph with Planner + CodeAct architecture
 *
 * Graph flow:
 * START → planner → codeact → planner → codeact → ... → END
 */
export function createAgentGraph(graphConfig: AgentGraphConfig) {
    const { browserAdapter, llmConfig, agentConfig } = graphConfig;
    const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...agentConfig };

    // Create node functions
    const plannerNode = createPlannerNode(llmConfig);
    const codeActNode = createCodeActNode(browserAdapter, {
        ...llmConfig,
        mode: config.executionMode,
    });

    // Build the graph: planner ↔ codeact loop
    const graph = new StateGraph(AgentStateAnnotation)
        .addNode('planner', plannerNode)
        .addNode('codeact', codeActNode)
        .addEdge(START, 'planner')
        .addEdge('codeact', 'planner')
        .addConditionalEdges('planner', routeAfterPlanner, {
            codeact: 'codeact',
            end: END,
        });

    return graph;
}

/**
 * Route function after Beads planner node
 */
function routeAfterBeadsPlanner(state: AgentState): string {
    if (state.status === 'error') {
        return 'end';
    }
    if (state.isComplete) {
        return 'end';
    }
    // If planning is complete, go to router
    if (state.beadsPlanningComplete) {
        return 'router';
    }
    // Still planning - this shouldn't happen for single-shot planning
    log.warn('Beads planner returned without completing planning');
    return 'end';
}

/**
 * Route function after router node
 */
function routeAfterRouter(state: AgentState): string {
    if (state.status === 'error') {
        return 'planner'; // Let planner handle errors
    }
    if (state.isComplete) {
        return 'end';
    }
    // Continue routing
    return 'planner';
}

/**
 * Creates the Beads-enabled agent graph
 *
 * Graph flow:
 * START → beads-planner (create tasks) → router (dispatch) → beads-planner (check) → router → ... → END
 */
export function createBeadsAgentGraph(graphConfig: BeadsAgentGraphConfig) {
    const { browserAdapter, llmConfig, agentConfig, beadsClient } = graphConfig;
    const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...agentConfig };

    // Create sub-agent registry and register CodeAct
    const subAgentRegistry = createSubAgentRegistry();
    subAgentRegistry.register(
        createCodeActSubAgent({
            browserAdapter,
            apiKey: llmConfig.apiKey,
            baseUrl: llmConfig.baseUrl,
            model: llmConfig.model,
        })
    );

    // Create node functions
    const beadsPlannerNode = createBeadsPlannerNode({
        beadsClient,
        ...llmConfig,
    });

    const routerNode = createRouterNode({
        beadsClient,
        subAgentRegistry,
        enableMerging: true,
        maxMergeSize: 5,
    });

    // Build the graph: beads-planner ↔ router loop
    const graph = new StateGraph(AgentStateAnnotation)
        .addNode('planner', beadsPlannerNode)
        .addNode('router', routerNode)
        .addEdge(START, 'planner')
        .addConditionalEdges('planner', routeAfterBeadsPlanner, {
            router: 'router',
            end: END,
        })
        .addConditionalEdges('router', routeAfterRouter, {
            planner: 'planner',
            end: END,
        });

    return graph;
}

// Re-export BrowserAgent and related types from its own module
export { BrowserAgent, type BrowserAgentConfig } from './browser-agent';
