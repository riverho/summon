// Condition Engine — Conditional Edge Evaluation for Rituals
// Enables runtime branching based on step results

import { callLlm, getFastModel } from '../runtime/llm.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Condition configuration from YAML ritual
 */
export interface Condition {
  id: string;
  from: string;           // Step ID that triggers this condition
  condition: string;      // Natural language or expression to evaluate
  then: string;          // Step ID to go to if condition is true
  else: string;          // Step ID to go to if condition is false
  evaluation?: EvaluationConfig;
}

/**
 * Global evaluation settings for all conditions
 */
export interface EvaluationConfig {
  model?: string;        // Model to use for evaluation (default: ritual's model)
  timeout?: number;      // Timeout in milliseconds
  maxRetries?: number;   // Max retries on failure
}

/**
 * Context available during condition evaluation
 */
export interface ConditionContext {
  stepResults: Map<string, StepResult>;
  currentStepId: string;
  userQuery: string;
  accumulatedOutput: string;
}

/**
 * Result of a completed step
 */
export interface StepResult {
  stepId: string;
  success: boolean;
  output: unknown;
  metadata: {
    tokensUsed: number;
    durationMs: number;
    model: string;
  };
}

/**
 * Evaluation method for conditions
 */
export type EvaluationMethod = 'natural-language' | 'expression' | 'function';

/**
 * Result of condition evaluation
 */
export interface ConditionEvaluationResult {
  conditionId: string;
  outcome: 'then' | 'else';
  method: EvaluationMethod;
  confidence: number;
  reasoning?: string;
  durationMs: number;
}

/**
 * Tracing information for debugging
 */
export interface ConditionTrace {
  conditionId: string;
  from: string;
  condition: string;
  then: string;
  else: string;
  evaluatedAt: number;
  context: {
    stepResultsAvailable: string[];
    currentStepId: string;
  };
  result: ConditionEvaluationResult;
}

// ============================================================================
// Condition Engine
// ============================================================================

export class ConditionEngine {
  private traces: ConditionTrace[] = [];
  private defaultConfig: EvaluationConfig;

  constructor(config: EvaluationConfig = {}) {
    this.defaultConfig = {
      model: 'default',
      timeout: 5000,
      maxRetries: 2,
      ...config,
    };
  }

  /**
   * Evaluate a condition and return the branch to take
   */
  async evaluate(
    condition: Condition,
    context: ConditionContext
  ): Promise<ConditionEvaluationResult> {
    const startTime = Date.now();
    const method = this.detectEvaluationMethod(condition.condition);

    let outcome: boolean;
    let reasoning: string | undefined;

    try {
      switch (method) {
        case 'function':
          outcome = await this.evaluateFunction(condition.condition, context);
          break;
        case 'expression':
          outcome = this.evaluateExpression(condition.condition, context);
          break;
        case 'natural-language':
        default:
          const nlResult = await this.evaluateNaturalLanguage(
            condition.condition,
            context,
            condition.evaluation
          );
          outcome = nlResult.outcome;
          reasoning = nlResult.reasoning;
          break;
      }
    } catch (error) {
      // On evaluation error, default to 'else' branch
      console.warn(`Condition evaluation failed for ${condition.id}:`, error);
      outcome = false;
      reasoning = `Evaluation error: ${error}`;
    }

    const durationMs = Date.now() - startTime;

    const result: ConditionEvaluationResult = {
      conditionId: condition.id,
      outcome: outcome ? 'then' : 'else',
      method,
      confidence: reasoning ? 0.8 : 0.9, // Higher confidence for programmatic eval
      reasoning,
      durationMs,
    };

    // Record trace
    this.traces.push({
      conditionId: condition.id,
      from: condition.from,
      condition: condition.condition,
      then: condition.then,
      else: condition.else,
      evaluatedAt: Date.now(),
      context: {
        stepResultsAvailable: Array.from(context.stepResults.keys()),
        currentStepId: context.currentStepId,
      },
      result,
    });

    return result;
  }

  /**
   * Detect which evaluation method to use based on condition string
   */
  private detectEvaluationMethod(condition: string): EvaluationMethod {
    const trimmed = condition.trim();
    
    // Function-based: starts with '(' or contains '=>'
    if (trimmed.startsWith('(') || trimmed.includes('=>') || trimmed.startsWith('function')) {
      return 'function';
    }
    
    // Expression: contains ${...} or comparison operators with variable-like patterns
    if (trimmed.includes('${') || /^[a-zA-Z_][a-zA-Z0-9_]*\s*[<>=!]+/.test(trimmed)) {
      return 'expression';
    }
    
    // Default to natural language
    return 'natural-language';
  }

  /**
   * Evaluate a natural language condition using LLM
   */
  private async evaluateNaturalLanguage(
    condition: string,
    context: ConditionContext,
    config?: EvaluationConfig
  ): Promise<{ outcome: boolean; reasoning: string }> {
    const currentResult = context.stepResults.get(context.currentStepId);
    const outputStr = this.formatOutputForEvaluation(currentResult?.output);

    const prompt = `You are evaluating a condition for a workflow system.

Condition to evaluate: "${condition}"

Current step output:
${outputStr}

User query: ${context.userQuery}

Based on the current step output, evaluate whether this condition is TRUE or FALSE.

Respond in JSON format:
{
  "outcome": true | false,
  "reasoning": "brief explanation of why"
}`;

    const mergedConfig = { ...this.defaultConfig, ...config };
    const model = mergedConfig.model === 'default' ? getFastModel('openai', 'gpt-4o-mini') : mergedConfig.model;

    try {
      const response = await callLlm(prompt, {
        model,
        systemPrompt: 'You are a condition evaluator. Respond only with valid JSON.',
      });

      const content = String(response || '').trim();
      
      // Try to parse JSON response
      try {
        const parsed = JSON.parse(content);
        return {
          outcome: Boolean(parsed.outcome),
          reasoning: String(parsed.reasoning || ''),
        };
      } catch {
        // Fallback: look for true/false in response
        const lower = content.toLowerCase();
        if (lower.includes('"outcome": true') || lower.includes('outcome: true')) {
          return { outcome: true, reasoning: content };
        }
        return { outcome: false, reasoning: content };
      }
    } catch (error) {
      // On timeout or error, log and default to false
      console.warn(`Natural language evaluation timed out or failed:`, error);
      return { outcome: false, reasoning: `Evaluation failed: ${error}` };
    }
  }

  /**
   * Evaluate a structured expression with variables
   */
  private evaluateExpression(
    expression: string,
    context: ConditionContext
  ): boolean {
    // Replace ${stepId.property} with actual values
    let evaluatedExpr = expression;
    
    // Match ${stepId.property} or ${stepId}
    const variableRegex = /\$\{([^}]+)\}/g;
    const matches = expression.matchAll(variableRegex);
    
    for (const match of matches) {
      const path = match[1].trim();
      const value = this.getValueFromContext(path, context);
      
      // Replace with the actual value (stringify for comparison)
      if (typeof value === 'string') {
        evaluatedExpr = evaluatedExpr.replace(match[0], `"${value}"`);
      } else if (typeof value === 'number') {
        evaluatedExpr = evaluatedExpr.replace(match[0], String(value));
      } else if (typeof value === 'boolean') {
        evaluatedExpr = evaluatedExpr.replace(match[0], String(value));
      } else if (value === null || value === undefined) {
        evaluatedExpr = evaluatedExpr.replace(match[0], 'null');
      } else {
        evaluatedExpr = evaluatedExpr.replace(match[0], JSON.stringify(value));
      }
    }

    // Also support direct property access like "confidence < 0.8"
    // Try to infer from current step result
    const currentResult = context.stepResults.get(context.currentStepId);
    if (currentResult?.output && typeof currentResult.output === 'object') {
      const output = currentResult.output as Record<string, unknown>;
      
      // Replace property names with values if they exist in output
      for (const key of Object.keys(output)) {
        const value = output[key];
        // Create a regex that matches the key as a standalone word (not in quotes)
        const keyRegex = new RegExp(`\\b${key}\\b`, 'g');
        
        if (typeof value === 'string') {
          evaluatedExpr = evaluatedExpr.replace(keyRegex, `"${value}"`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          evaluatedExpr = evaluatedExpr.replace(keyRegex, String(value));
        }
      }
    }

    // Evaluate the expression safely
    try {
      // Use Function constructor for safe-ish evaluation
      // This is safer than eval() but still executes code
      // In production, consider using a proper expression parser
      const fn = new Function(`return (${evaluatedExpr})`);
      const result = fn();
      return Boolean(result);
    } catch (error) {
      console.warn(`Expression evaluation failed: ${evaluatedExpr}`, error);
      return false;
    }
  }

  /**
   * Evaluate a JavaScript function condition
   */
  private async evaluateFunction(
    condition: string,
    context: ConditionContext
  ): Promise<boolean> {
    try {
      // Wrap in async function if not already
      let fnBody = condition.trim();
      if (!fnBody.startsWith('async') && !fnBody.includes('=>')) {
        fnBody = `async ${fnBody}`;
      }

      // Create function that takes context
      const fn = new Function('ctx', `
        const { stepResults, currentStepId, userQuery, accumulatedOutput } = ctx;
        return (${fnBody})(ctx);
      `);

      const result = await fn(context);
      return Boolean(result);
    } catch (error) {
      console.warn(`Function evaluation failed:`, error);
      return false;
    }
  }

  /**
   * Get a value from context using dot notation path
   */
  private getValueFromContext(path: string, context: ConditionContext): unknown {
    const parts = path.split('.');
    
    if (parts.length === 0) return undefined;
    
    const stepId = parts[0];
    const stepResult = context.stepResults.get(stepId);
    
    if (!stepResult) return undefined;
    
    if (parts.length === 1) {
      return stepResult.output;
    }
    
    // Navigate nested properties
    let value: unknown = stepResult.output;
    for (let i = 1; i < parts.length; i++) {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== 'object') return undefined;
      value = (value as Record<string, unknown>)[parts[i]];
    }
    
    return value;
  }

  /**
   * Format output for evaluation in LLM context
   */
  private formatOutputForEvaluation(output: unknown): string {
    if (output === null || output === undefined) {
      return '(no output)';
    }
    
    if (typeof output === 'string') {
      return output.slice(0, 2000); // Limit length
    }
    
    if (typeof output === 'object') {
      return JSON.stringify(output, null, 2).slice(0, 2000);
    }
    
    return String(output);
  }

  /**
   * Get all recorded traces
   */
  getTraces(): ConditionTrace[] {
    return [...this.traces];
  }

  /**
   * Clear all traces
   */
  clearTraces(): void {
    this.traces = [];
  }

  /**
   * Export traces as Mermaid diagram
   */
  exportMermaidDiagram(conditions: Condition[]): string {
    const lines: string[] = ['graph TD'];
    const nodeIds = new Map<string, string>();
    let nodeCounter = 0;

    // Helper to get or create node ID
    const getNodeId = (stepId: string): string => {
      if (!nodeIds.has(stepId)) {
        nodeIds.set(stepId, `N${nodeCounter++}`);
      }
      return nodeIds.get(stepId)!;
    };

    // Add all condition nodes
    for (const condition of conditions) {
      const fromId = getNodeId(condition.from);
      const thenId = getNodeId(condition.then);
      const elseId = getNodeId(condition.else);

      // Add decision node (diamond shape)
      const decisionId = `D${condition.id}`;
      lines.push(`    ${fromId}[${condition.from}] --> ${decisionId}{${condition.condition}}`);
      lines.push(`    ${decisionId} -->|then| ${thenId}[${condition.then}]`);
      lines.push(`    ${decisionId} -->|else| ${elseId}[${condition.else}]`);
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate a condition configuration
 */
export function validateCondition(
  condition: Condition,
  availableSteps: string[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!condition.id) {
    errors.push('Condition must have an id');
  }

  if (!condition.from) {
    errors.push('Condition must have a "from" step');
  } else if (!availableSteps.includes(condition.from)) {
    errors.push(`"from" step "${condition.from}" not found in available steps`);
  }

  if (!condition.condition) {
    errors.push('Condition must have a condition expression');
  }

  if (!condition.then) {
    errors.push('Condition must have a "then" target');
  } else if (condition.then !== 'complete' && !availableSteps.includes(condition.then)) {
    errors.push(`"then" target "${condition.then}" not found in available steps`);
  }

  if (!condition.else) {
    errors.push('Condition must have an "else" target');
  } else if (condition.else !== 'complete' && !availableSteps.includes(condition.else)) {
    errors.push(`"else" target "${condition.else}" not found in available steps`);
  }

  // Check for self-loops that might cause infinite loops
  if (condition.then === condition.from && condition.else === condition.from) {
    errors.push('Condition creates an infinite loop (both branches return to source)');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all conditions in a ritual
 */
export function validateConditions(
  conditions: Condition[],
  availableSteps: string[]
): { valid: boolean; errors: Array<{ conditionId: string; errors: string[] }> } {
  const allErrors: Array<{ conditionId: string; errors: string[] }> = [];

  for (const condition of conditions) {
    const result = validateCondition(condition, availableSteps);
    if (!result.valid) {
      allErrors.push({ conditionId: condition.id, errors: result.errors });
    }
  }

  // Check for conflicting conditions (multiple conditions from same step)
  const fromCounts = new Map<string, number>();
  for (const condition of conditions) {
    const count = fromCounts.get(condition.from) || 0;
    fromCounts.set(condition.from, count + 1);
  }

  for (const [stepId, count] of fromCounts.entries()) {
    if (count > 1) {
      allErrors.push({
        conditionId: 'global',
        errors: [`Step "${stepId}" has ${count} conditions - only one condition per step is supported`],
      });
    }
  }

  return { valid: allErrors.length === 0, errors: allErrors };
}

// ============================================================================
// Factory Function
// ============================================================================

export function createConditionEngine(config?: EvaluationConfig): ConditionEngine {
  return new ConditionEngine(config);
}
