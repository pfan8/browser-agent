/**
 * Sub-Agent Registry
 *
 * Manages registration and lookup of sub-agents.
 * Used by the Router to find the appropriate sub-agent for each task.
 */

import type { BeadsTask } from '../beads/types';
import type { ISubAgent, ISubAgentRegistry } from './types';
import { createAgentLogger } from '../tracing';

const log = createAgentLogger('SubAgentRegistry');

/**
 * Default implementation of sub-agent registry
 */
export class SubAgentRegistry implements ISubAgentRegistry {
    private agents: Map<string, ISubAgent> = new Map();

    /**
     * Register a sub-agent
     */
    register(agent: ISubAgent): void {
        if (this.agents.has(agent.name)) {
            log.warn('Replacing existing sub-agent', { name: agent.name });
        }
        this.agents.set(agent.name, agent);
        log.info('Sub-agent registered', {
            name: agent.name,
            supportedTypes: agent.supportedTypes,
        });
    }

    /**
     * Get all registered sub-agents
     */
    getAll(): ISubAgent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Find a sub-agent that can handle the given task
     */
    findForTask(task: BeadsTask): ISubAgent | null {
        for (const agent of this.agents.values()) {
            if (agent.canHandle(task)) {
                return agent;
            }
        }
        return null;
    }

    /**
     * Find a sub-agent by name
     */
    findByName(name: string): ISubAgent | null {
        return this.agents.get(name) || null;
    }

    /**
     * Unregister a sub-agent
     */
    unregister(name: string): boolean {
        const existed = this.agents.has(name);
        this.agents.delete(name);
        if (existed) {
            log.info('Sub-agent unregistered', { name });
        }
        return existed;
    }

    /**
     * Clear all registered sub-agents
     */
    clear(): void {
        this.agents.clear();
        log.info('All sub-agents cleared');
    }
}

/**
 * Create a new sub-agent registry
 */
export function createSubAgentRegistry(): ISubAgentRegistry {
    return new SubAgentRegistry();
}

