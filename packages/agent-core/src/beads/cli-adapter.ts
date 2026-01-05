/**
 * Beads CLI Adapter
 *
 * Implementation of IBeadsClient that wraps the `bd` CLI command.
 * Parses JSON output from bd commands for programmatic access.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { IBeadsClient } from './beads-client';
import type {
    BeadsTask,
    CreateTaskOptions,
    ListTasksFilter,
    BeadsOperationResult,
    BeadsPriority,
} from './types';

const execAsync = promisify(exec);

/**
 * Parse a Beads task from JSON output
 */
function parseBeadsTask(json: Record<string, unknown>): BeadsTask {
    return {
        id: (json.id as string) || '',
        title: (json.title as string) || (json.summary as string) || '',
        priority: ((json.priority as number) || 1) as BeadsPriority,
        status: (json.status as 'open' | 'closed') || 'open',
        blockedBy:
            (json.blocked_by as string[]) || (json.blockedBy as string[]) || [],
        blocks: (json.blocks as string[]) || [],
        parentId: json.parent_id as string | undefined,
        children: (json.children as string[]) || [],
        createdAt:
            (json.created_at as string) ||
            (json.createdAt as string) ||
            new Date().toISOString(),
        updatedAt:
            (json.updated_at as string) ||
            (json.updatedAt as string) ||
            new Date().toISOString(),
        metadata: json.metadata as Record<string, unknown> | undefined,
    };
}

/**
 * CLI-based implementation of Beads client
 */
export class BeadsCliAdapter implements IBeadsClient {
    private workspacePath: string;
    private bdCommand: string;

    constructor(workspacePath: string, bdCommand: string = 'bd') {
        this.workspacePath = workspacePath;
        this.bdCommand = bdCommand;
    }

    /**
     * Execute a bd command and return stdout
     */
    private async execBd(args: string): Promise<string> {
        const command = `${this.bdCommand} ${args}`;
        try {
            const { stdout } = await execAsync(command, {
                cwd: this.workspacePath,
                timeout: 30000,
            });
            return stdout.trim();
        } catch (error) {
            const err = error as { stderr?: string; message?: string };
            throw new Error(
                `Beads command failed: ${err.stderr || err.message}`
            );
        }
    }

    /**
     * Execute a bd command and parse JSON output
     */
    private async execBdJson<T>(args: string): Promise<T> {
        const output = await this.execBd(`${args} --json`);
        try {
            return JSON.parse(output) as T;
        } catch {
            throw new Error(`Failed to parse Beads JSON output: ${output}`);
        }
    }

    async init(): Promise<BeadsOperationResult> {
        try {
            await this.execBd('init --stealth');
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message,
            };
        }
    }

    async create(
        title: string,
        options?: CreateTaskOptions
    ): Promise<BeadsTask> {
        const args: string[] = ['create', `"${title.replace(/"/g, '\\"')}"`];

        if (options?.priority !== undefined) {
            args.push(`-p ${options.priority}`);
        }

        if (options?.parentId) {
            args.push(`--parent ${options.parentId}`);
        }

        const output = await this.execBdJson<Record<string, unknown>>(
            args.join(' ')
        );
        const task = parseBeadsTask(output);

        // Add dependencies if specified
        // blockedBy means: blockerId blocks task.id, so we call addDependency(blockerId, task.id)
        if (options?.blockedBy && options.blockedBy.length > 0) {
            for (const blockerId of options.blockedBy) {
                await this.addDependency(blockerId, task.id, 'blocks');
            }
            task.blockedBy = options.blockedBy;
        }

        return task;
    }

    /**
     * Add a dependency between two tasks.
     *
     * @param blockerId - The task that blocks/is a prerequisite
     * @param blockedId - The task that is blocked/depends on blockerId
     * @param type - Dependency type ('blocks' creates: blockerId blocks blockedId)
     */
    async addDependency(
        blockerId: string,
        blockedId: string,
        type: 'blocks' | 'related' | 'parent' = 'blocks'
    ): Promise<BeadsOperationResult> {
        try {
            // bd dep add A B --type blocks → A blocks B
            await this.execBd(
                `dep add ${blockerId} ${blockedId} --type ${type}`
            );
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message,
            };
        }
    }

    async getReady(): Promise<BeadsTask[]> {
        try {
            const output = await this.execBdJson<Record<string, unknown>[]>(
                'ready'
            );
            return output.map(parseBeadsTask);
        } catch {
            // No ready tasks or not initialized
            return [];
        }
    }

    async close(id: string, result?: string): Promise<BeadsOperationResult> {
        try {
            const args = ['close', id];
            if (result) {
                args.push(`--comment "${result.replace(/"/g, '\\"')}"`);
            }
            await this.execBd(args.join(' '));
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message,
            };
        }
    }

    async show(id: string): Promise<BeadsTask | null> {
        try {
            const output = await this.execBdJson<Record<string, unknown>>(
                `show ${id}`
            );
            return parseBeadsTask(output);
        } catch {
            return null;
        }
    }

    async list(filter?: ListTasksFilter): Promise<BeadsTask[]> {
        try {
            const args: string[] = ['list'];

            if (filter?.status) {
                args.push(`--status ${filter.status}`);
            }
            if (filter?.parentId) {
                args.push(`--parent ${filter.parentId}`);
            }
            if (filter?.ready) {
                // Use ready command instead
                return this.getReady();
            }
            if (filter?.limit) {
                args.push(`--limit ${filter.limit}`);
            }

            const output = await this.execBdJson<Record<string, unknown>[]>(
                args.join(' ')
            );
            return output.map(parseBeadsTask);
        } catch {
            return [];
        }
    }

    async update(
        id: string,
        updates: Partial<Pick<BeadsTask, 'title' | 'priority' | 'metadata'>>
    ): Promise<BeadsOperationResult> {
        try {
            const args: string[] = ['update', id];

            if (updates.title) {
                args.push(`--title "${updates.title.replace(/"/g, '\\"')}"`);
            }
            if (updates.priority !== undefined) {
                args.push(`-p ${updates.priority}`);
            }

            await this.execBd(args.join(' '));
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message,
            };
        }
    }

    async isInitialized(): Promise<boolean> {
        try {
            await this.execBd('list --limit 1');
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Create a Beads CLI adapter instance
 */
export function createBeadsCliAdapter(
    workspacePath: string,
    bdCommand?: string
): IBeadsClient {
    return new BeadsCliAdapter(workspacePath, bdCommand);
}
