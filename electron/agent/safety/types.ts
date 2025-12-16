/**
 * Safety Types for Human-in-the-Loop Confirmation
 * 
 * Defines types for risk assessment and confirmation dialogs.
 */

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  reasons: string[];
}

export interface TargetElement {
  tag: string;
  selector: string;
  text?: string;
}

export interface ConfirmationAction {
  tool: string;
  args: Record<string, unknown>;
  reasoning?: string;
  targetElement?: TargetElement;
}

export interface ConfirmationRequest {
  id: string;
  action: ConfirmationAction;
  risk: RiskAssessment;
  timeout: number;
  timestamp: string;
}

export interface ConfirmationResponse {
  confirmed: boolean;
  comment?: string;
}

