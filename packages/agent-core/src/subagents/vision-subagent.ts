/**
 * Vision SubAgent
 *
 * Handles image analysis using vision-capable LLMs.
 * Can analyze screenshots, uploaded images, and provide structured descriptions.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as fs from 'fs';
import {
    BaseSubAgent,
    type SubAgentRequest,
    type SubAgentContext,
    type SubAgentResult,
    type ContentBlockType,
    type ImageBlock,
    createMultimodalMessage,
    extractText,
    extractBlocks,
} from '../multimodal';
import { createAgentLogger } from '../tracing';

const log = createAgentLogger('VisionSubAgent');

// ============================================================
// Configuration
// ============================================================

/**
 * Configuration for Vision SubAgent
 */
export interface VisionSubAgentConfig {
    /** Model to use (must support vision) */
    model?: string;
    /** Maximum image dimension (for resizing) */
    maxImageDimension?: number;
}

const DEFAULT_CONFIG: Required<VisionSubAgentConfig> = {
    model: 'claude-sonnet-4-20250514',
    maxImageDimension: 1568, // Anthropic recommended max
};

// ============================================================
// Prompts
// ============================================================

const VISION_SYSTEM_PROMPT = `You are a vision analysis assistant specialized in UI and web content analysis.

Your capabilities:
1. Describe UI elements, layouts, and visual hierarchy
2. Extract text content from images
3. Identify interactive elements (buttons, links, forms)
4. Detect accessibility issues
5. Provide structured analysis for automation

When analyzing screenshots:
- Identify all interactive elements with their approximate positions
- Note any error messages or alerts
- Describe the current state (loading, error, success, etc.)
- Extract visible text content

Output format depends on the task:
- For general analysis: Provide a structured description
- For element finding: List elements with selectors/descriptions
- For text extraction: Return the text content
- For automation: Suggest actions to take`;

// ============================================================
// Implementation
// ============================================================

/**
 * Vision SubAgent V3 implementation
 */
export class VisionSubAgent extends BaseSubAgent {
    readonly name = 'vision';
    readonly description =
        'Analyzes images and screenshots using vision AI for UI understanding';
    readonly inputTypes: ContentBlockType[] = ['image', 'text'];
    readonly outputTypes: ContentBlockType[] = ['text'];
    readonly priority = 90; // High priority for image tasks

    private config: Required<VisionSubAgentConfig>;

    constructor(config?: VisionSubAgentConfig) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if this SubAgent can handle the request
     */
    canHandle(request: SubAgentRequest): boolean {
        // Vision handles requests with images
        return request.input.content.some((c) => c.type === 'image');
    }

    /**
     * Execute vision analysis
     */
    async execute(
        request: SubAgentRequest,
        context: SubAgentContext
    ): Promise<SubAgentResult> {
        const startTime = Date.now();

        try {
            // Extract images and text instruction
            const images = extractBlocks<ImageBlock>(request.input, 'image');
            const instruction = extractText(request.input) || 'Analyze this image';

            log.info('[VISION] Starting analysis', {
                imageCount: images.length,
                instruction: instruction.substring(0, 100),
            });

            if (images.length === 0) {
                return this.createErrorResult(
                    'No images provided for analysis',
                    Date.now() - startTime
                );
            }

            // Build multimodal message for LLM
            const messageContent = await this.buildMessageContent(
                images,
                instruction
            );

            // Call vision LLM
            const messages = [
                new SystemMessage(VISION_SYSTEM_PROMPT),
                new HumanMessage({ content: messageContent }),
            ];

            const response = await context.llm.invoke(messages);
            const analysisResult =
                typeof response.content === 'string'
                    ? response.content
                    : JSON.stringify(response.content);

            const duration = Date.now() - startTime;

            log.info('[VISION] Analysis complete', {
                duration,
                resultLength: analysisResult.length,
            });

            return this.createSuccessResult(
                createMultimodalMessage(
                    [{ type: 'text', text: analysisResult }],
                    'subagent'
                ),
                [],
                duration,
                {
                    updatedVariables: {
                        lastVisionAnalysis: analysisResult,
                        analyzedImageCount: images.length,
                    },
                }
            );
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg =
                error instanceof Error ? error.message : String(error);
            log.error('[VISION] Analysis error', { error: errorMsg });
            return this.createErrorResult(errorMsg, duration);
        }
    }

    /**
     * Build message content with images
     */
    private async buildMessageContent(
        images: ImageBlock[],
        instruction: string
    ): Promise<Array<{ type: string; text?: string; image_url?: { url: string } }>> {
        const content: Array<{
            type: string;
            text?: string;
            image_url?: { url: string };
        }> = [];

        // Add instruction
        content.push({
            type: 'text',
            text: instruction,
        });

        // Add images
        for (const image of images) {
            const imageUrl = await this.getImageUrl(image);
            content.push({
                type: 'image_url',
                image_url: { url: imageUrl },
            });
        }

        return content;
    }

    /**
     * Get image URL (base64 data URL or file URL)
     */
    private async getImageUrl(image: ImageBlock): Promise<string> {
        const source = image.source;

        // Already a data URL
        if (source.startsWith('data:')) {
            return source;
        }

        // File path - read and convert to base64
        if (fs.existsSync(source)) {
            const buffer = fs.readFileSync(source);
            const base64 = buffer.toString('base64');
            const mimeType = image.mimeType || 'image/png';
            return `data:${mimeType};base64,${base64}`;
        }

        // HTTP URL
        if (source.startsWith('http://') || source.startsWith('https://')) {
            return source;
        }

        throw new Error(`Invalid image source: ${source}`);
    }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a Vision SubAgent V3 instance
 */
export function createVisionSubAgent(
    config?: VisionSubAgentConfig
): VisionSubAgent {
    return new VisionSubAgent(config);
}

