/**
 * Artifact Manager
 *
 * Unified file management for all agent artifacts including:
 * - Input files (uploaded images, audio, video)
 * - Output files (screenshots, recordings, reports)
 * - Code artifacts (generated scripts)
 * - Temporary files
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ArtifactRef, ArtifactType } from './types';
import { generateArtifactId } from './types';

/**
 * Configuration for ArtifactManager
 */
export interface ArtifactManagerConfig {
    /** Base directory for all artifacts */
    basePath: string;
    /** Maximum artifact age in days (for cleanup) */
    maxAgeDays?: number;
    /** Maximum total size in bytes */
    maxTotalSize?: number;
}

/**
 * Subdirectory structure
 */
const SUBDIRS: Record<ArtifactType, string> = {
    screenshot: 'screenshots',
    video: 'videos',
    audio: 'audio',
    code: 'scripts',
    report: 'reports',
    log: 'logs',
    data: 'data',
};

/**
 * Manages artifact storage and retrieval
 */
export class ArtifactManager {
    private basePath: string;
    private maxAgeDays: number;
    private maxTotalSize: number;
    private artifactRegistry: Map<string, ArtifactRef> = new Map();

    constructor(config: ArtifactManagerConfig) {
        this.basePath = config.basePath;
        this.maxAgeDays = config.maxAgeDays ?? 7;
        this.maxTotalSize = config.maxTotalSize ?? 1024 * 1024 * 1024; // 1GB default
        this.ensureDirectories();
    }

    /**
     * Ensure all required directories exist
     */
    private ensureDirectories(): void {
        // Create base .artifacts directory
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }

        // Create subdirectories
        for (const subdir of Object.values(SUBDIRS)) {
            const fullPath = path.join(this.basePath, subdir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
            }
        }

        // Create inputs directory
        const inputsPath = path.join(this.basePath, 'inputs');
        if (!fs.existsSync(inputsPath)) {
            fs.mkdirSync(inputsPath, { recursive: true });
        }

        // Create temp directory
        const tempPath = path.join(this.basePath, 'temp');
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true });
        }
    }

    /**
     * Get the directory path for a specific artifact type
     */
    getTypePath(type: ArtifactType): string {
        return path.join(this.basePath, SUBDIRS[type]);
    }

    /**
     * Get a full path for a new artifact
     */
    getPath(type: ArtifactType, filename: string): string {
        return path.join(this.getTypePath(type), filename);
    }

    /**
     * Save binary data as an artifact
     */
    async saveBuffer(
        type: ArtifactType,
        filename: string,
        data: Buffer,
        metadata?: Record<string, unknown>
    ): Promise<ArtifactRef> {
        const filePath = this.getPath(type, filename);

        // Write file
        fs.writeFileSync(filePath, data);

        // Create artifact reference
        const artifact: ArtifactRef = {
            id: generateArtifactId(),
            type,
            path: filePath,
            createdAt: new Date(),
            size: data.length,
            metadata,
        };

        // Register artifact
        this.artifactRegistry.set(artifact.id, artifact);

        return artifact;
    }

    /**
     * Save text content as an artifact
     */
    async saveText(
        type: ArtifactType,
        filename: string,
        content: string,
        metadata?: Record<string, unknown>
    ): Promise<ArtifactRef> {
        const buffer = Buffer.from(content, 'utf-8');
        return this.saveBuffer(type, filename, buffer, metadata);
    }

    /**
     * Save a screenshot (convenience method)
     */
    async saveScreenshot(
        data: Buffer,
        name?: string,
        metadata?: Record<string, unknown>
    ): Promise<ArtifactRef> {
        const filename = name || `screenshot-${Date.now()}.png`;
        return this.saveBuffer('screenshot', filename, data, metadata);
    }

    /**
     * Save code as an artifact
     */
    async saveCode(
        code: string,
        language: string,
        name?: string,
        metadata?: Record<string, unknown>
    ): Promise<ArtifactRef> {
        const ext = getExtensionForLanguage(language);
        const filename = name || `script-${Date.now()}${ext}`;
        return this.saveText('code', filename, code, {
            language,
            ...metadata,
        });
    }

    /**
     * Read an artifact by its ID
     */
    async readArtifact(id: string): Promise<Buffer | null> {
        const artifact = this.artifactRegistry.get(id);
        if (!artifact) return null;

        if (!fs.existsSync(artifact.path)) return null;

        return fs.readFileSync(artifact.path);
    }

    /**
     * Read artifact as text
     */
    async readArtifactText(id: string): Promise<string | null> {
        const buffer = await this.readArtifact(id);
        if (!buffer) return null;
        return buffer.toString('utf-8');
    }

    /**
     * Get artifact reference by ID
     */
    getArtifact(id: string): ArtifactRef | null {
        return this.artifactRegistry.get(id) || null;
    }

    /**
     * List all artifacts of a specific type
     */
    listArtifacts(type?: ArtifactType): ArtifactRef[] {
        const artifacts = Array.from(this.artifactRegistry.values());
        if (!type) return artifacts;
        return artifacts.filter((a) => a.type === type);
    }

    /**
     * Delete an artifact
     */
    async deleteArtifact(id: string): Promise<boolean> {
        const artifact = this.artifactRegistry.get(id);
        if (!artifact) return false;

        try {
            if (fs.existsSync(artifact.path)) {
                fs.unlinkSync(artifact.path);
            }
            this.artifactRegistry.delete(id);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Save an input file (uploaded by user)
     */
    async saveInput(
        filename: string,
        data: Buffer,
        metadata?: Record<string, unknown>
    ): Promise<string> {
        const inputPath = path.join(this.basePath, 'inputs', filename);
        fs.writeFileSync(inputPath, data);
        return inputPath;
    }

    /**
     * Save a temporary file
     */
    async saveTemp(filename: string, data: Buffer): Promise<string> {
        const tempPath = path.join(this.basePath, 'temp', filename);
        fs.writeFileSync(tempPath, data);
        return tempPath;
    }

    /**
     * Clean up old artifacts
     */
    async cleanup(): Promise<{ deleted: number; freedBytes: number }> {
        let deleted = 0;
        let freedBytes = 0;

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.maxAgeDays);

        for (const [id, artifact] of this.artifactRegistry) {
            if (artifact.createdAt < cutoffDate) {
                const size = artifact.size || 0;
                if (await this.deleteArtifact(id)) {
                    deleted++;
                    freedBytes += size;
                }
            }
        }

        // Clean temp directory
        const tempPath = path.join(this.basePath, 'temp');
        if (fs.existsSync(tempPath)) {
            const tempFiles = fs.readdirSync(tempPath);
            for (const file of tempFiles) {
                const filePath = path.join(tempPath, file);
                const stats = fs.statSync(filePath);
                if (stats.mtime < cutoffDate) {
                    fs.unlinkSync(filePath);
                    deleted++;
                    freedBytes += stats.size;
                }
            }
        }

        return { deleted, freedBytes };
    }

    /**
     * Get total size of all artifacts
     */
    getTotalSize(): number {
        let total = 0;
        for (const artifact of this.artifactRegistry.values()) {
            total += artifact.size || 0;
        }
        return total;
    }

    /**
     * Check if an artifact exists
     */
    exists(id: string): boolean {
        const artifact = this.artifactRegistry.get(id);
        if (!artifact) return false;
        return fs.existsSync(artifact.path);
    }

    /**
     * Get the base path
     */
    getBasePath(): string {
        return this.basePath;
    }
}

/**
 * Get file extension for a programming language
 */
function getExtensionForLanguage(language: string): string {
    const extensions: Record<string, string> = {
        typescript: '.ts',
        javascript: '.js',
        python: '.py',
        json: '.json',
        html: '.html',
        css: '.css',
        markdown: '.md',
        shell: '.sh',
        bash: '.sh',
    };
    return extensions[language.toLowerCase()] || '.txt';
}

/**
 * Create an ArtifactManager instance
 */
export function createArtifactManager(
    workspacePath: string,
    config?: Partial<ArtifactManagerConfig>
): ArtifactManager {
    const basePath = path.join(workspacePath, '.artifacts');
    return new ArtifactManager({
        basePath,
        ...config,
    });
}

