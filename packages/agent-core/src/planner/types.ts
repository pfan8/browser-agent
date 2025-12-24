/**
 * Planner Types
 * 
 * Types for the Main Agent (Planner) which is responsible for
 * high-level task planning and progress monitoring.
 * The Planner does NOT know Playwright API - it only describes what to do.
 */

/**
 * Step status in a plan
 */
export type StepStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';

/**
 * A single step in the task plan
 */
export interface PlanStep {
  id: string;
  description: string;  // High-level description, e.g., "Navigate to google.com"
  status: StepStatus;
  result?: string;      // Result message from execution
  error?: string;       // Error message if failed
}

/**
 * Complete task plan
 */
export interface Plan {
  goal: string;
  steps: PlanStep[];
  currentStepIndex: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Planner's decision for the next step
 */
export interface PlannerDecision {
  thought: string;           // Planner's reasoning
  nextStep: string | null;   // High-level description of next step (null if complete)
  isComplete: boolean;       // Whether the task is complete
  completionMessage?: string; // Message to show user when complete
  needsMoreInfo?: boolean;   // Whether planner needs more information
  question?: string;         // Question to ask user if needsMoreInfo is true
}

/**
 * Observation summary for planner (simplified view of browser state)
 */
export interface PlannerObservation {
  url: string;
  title: string;
  summary?: string;        // Brief description of current page state
  lastActionResult?: {
    success: boolean;
    message: string;
  };
}

/**
 * History entry for planner context
 */
export interface PlannerHistoryEntry {
  step: string;           // What was requested
  success: boolean;       // Whether it succeeded
}

