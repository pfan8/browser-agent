/**
 * Trace Context
 * 
 * Provides distributed tracing context for the agent.
 * Each task execution gets a unique traceId that flows through
 * all layers: Electron -> Agent Core -> Browser Adapter.
 */

/**
 * Trace context that flows through all operations
 */
export interface TraceContext {
  /** Unique ID for the entire task execution */
  traceId: string;
  /** Unique ID for the current operation/span */
  spanId: string;
  /** Parent span ID for hierarchical tracing */
  parentSpanId?: string;
  /** Start time of this span in milliseconds */
  startTime: number;
  /** Metadata associated with this trace */
  metadata: Record<string, unknown>;
}

/**
 * Span event for tracking operations within a trace
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

/**
 * Completed span with timing and result information
 */
export interface CompletedSpan extends TraceContext {
  /** End time of the span */
  endTime: number;
  /** Duration in milliseconds */
  duration: number;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Events that occurred during the span */
  events: SpanEvent[];
}

// ============================================
// ID Generation
// ============================================

/**
 * Generate a random ID string
 */
function randomId(length: number = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a trace ID
 */
export function generateTraceId(): string {
  return `trace_${Date.now()}_${randomId(8)}`;
}

/**
 * Generate a span ID
 */
export function generateSpanId(): string {
  return `span_${randomId(12)}`;
}

// ============================================
// Trace Context Management
// ============================================

/**
 * Create a new trace context for a task
 */
export function createTraceContext(goal: string, metadata?: Record<string, unknown>): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    startTime: Date.now(),
    metadata: {
      goal,
      ...metadata,
    },
  };
}

/**
 * Create a child span from a parent context
 */
export function createChildSpan(
  parent: TraceContext,
  name: string,
  additionalMetadata?: Record<string, unknown>
): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
    startTime: Date.now(),
    metadata: {
      ...parent.metadata,
      spanName: name,
      ...additionalMetadata,
    },
  };
}

/**
 * Complete a span with result information
 */
export function completeSpan(
  context: TraceContext,
  success: boolean,
  error?: string,
  events: SpanEvent[] = []
): CompletedSpan {
  const endTime = Date.now();
  return {
    ...context,
    endTime,
    duration: endTime - context.startTime,
    success,
    error,
    events,
  };
}

/**
 * Add an event to the current span
 */
export function createSpanEvent(
  name: string,
  attributes?: Record<string, unknown>
): SpanEvent {
  return {
    name,
    timestamp: Date.now(),
    attributes,
  };
}

// ============================================
// Serialization
// ============================================

/**
 * Extract trace headers for passing between layers
 */
export function extractTraceHeaders(context: TraceContext): Record<string, string> {
  return {
    'x-trace-id': context.traceId,
    'x-span-id': context.spanId,
    'x-parent-span-id': context.parentSpanId || '',
  };
}

/**
 * Parse trace headers to create a context
 */
export function parseTraceHeaders(
  headers: Record<string, string>,
  fallbackGoal: string = 'unknown'
): TraceContext | null {
  const traceId = headers['x-trace-id'];
  const spanId = headers['x-span-id'];
  
  if (!traceId || !spanId) {
    return null;
  }
  
  return {
    traceId,
    spanId,
    parentSpanId: headers['x-parent-span-id'] || undefined,
    startTime: Date.now(),
    metadata: { goal: fallbackGoal },
  };
}

/**
 * Format trace context for logging
 */
export function formatTraceContext(context: TraceContext): string {
  const parts = [`traceId=${context.traceId}`, `spanId=${context.spanId}`];
  if (context.parentSpanId) {
    parts.push(`parentSpanId=${context.parentSpanId}`);
  }
  return parts.join(' ');
}

