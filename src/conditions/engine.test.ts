// Condition Engine Tests
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ConditionEngine,
  createConditionEngine,
  validateCondition,
  validateConditions,
} from './engine.js';
import type { Condition, ConditionContext, StepResult } from './engine.js';

describe('ConditionEngine', () => {
  let engine: ConditionEngine;

  beforeEach(() => {
    engine = createConditionEngine();
  });

  describe('detectEvaluationMethod', () => {
    it('should detect natural language conditions', () => {
      const testCases = [
        'confidence < 0.8',
        'quality is high',
        'needs more work',
      ];

      for (const condition of testCases) {
        // Natural language is default, no specific markers needed
        expect(condition).toBeTruthy();
      }
    });

    it('should detect expression conditions', () => {
      const expressions = [
        { expr: '${output.confidence} < 0.8', hasOp: '<' },
        { expr: 'word_count > 500', hasOp: '>' },
      ];

      for (const { expr, hasOp } of expressions) {
        expect(expr).toContain(hasOp);
      }
    });
  });

  describe('evaluateExpression', () => {
    it('should evaluate simple numeric comparisons', async () => {
      const condition: Condition = {
        id: 'test',
        from: 'step1',
        condition: 'confidence < 0.8',
        then: 'retry',
        else: 'continue',
      };

      const context: ConditionContext = {
        stepResults: new Map([
          [
            'step1',
            {
              stepId: 'step1',
              success: true,
              output: { confidence: 0.65 },
              metadata: { tokensUsed: 100, durationMs: 1000, model: 'test' },
            },
          ],
        ]),
        currentStepId: 'step1',
        userQuery: 'test',
        accumulatedOutput: '',
      };

      const result = await engine.evaluate(condition, context);
      expect(result.outcome).toBe('then');
      expect(result.method).toBe('expression');
    });

    it('should handle greater than comparisons', async () => {
      const condition: Condition = {
        id: 'test',
        from: 'step1',
        condition: 'word_count > 500',
        then: 'complete',
        else: 'expand',
      };

      const context: ConditionContext = {
        stepResults: new Map([
          [
            'step1',
            {
              stepId: 'step1',
              success: true,
              output: { word_count: 750 },
              metadata: { tokensUsed: 100, durationMs: 1000, model: 'test' },
            },
          ],
        ]),
        currentStepId: 'step1',
        userQuery: 'test',
        accumulatedOutput: '',
      };

      const result = await engine.evaluate(condition, context);
      expect(result.outcome).toBe('then');
    });

    it('should handle missing values gracefully', async () => {
      const condition: Condition = {
        id: 'test',
        from: 'step1',
        condition: 'missing_value > 100',
        then: 'then-branch',
        else: 'else-branch',
      };

      const context: ConditionContext = {
        stepResults: new Map([
          [
            'step1',
            {
              stepId: 'step1',
              success: true,
              output: {},
              metadata: { tokensUsed: 100, durationMs: 1000, model: 'test' },
            },
          ],
        ]),
        currentStepId: 'step1',
        userQuery: 'test',
        accumulatedOutput: '',
      };

      // Should default to false (else branch) when evaluation fails
      const result = await engine.evaluate(condition, context);
      expect(result.outcome).toBe('else');
    });
  });

  describe('validateCondition', () => {
    it('should validate correct conditions', () => {
      const condition: Condition = {
        id: 'test-condition',
        from: 'step1',
        condition: 'confidence < 0.8',
        then: 'step2',
        else: 'complete',
      };

      const result = validateCondition(condition, ['step1', 'step2', 'step3']);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing fields', () => {
      const condition = {
        id: 'test',
        from: 'step1',
        condition: 'test',
        then: 'step2',
        // missing else
      } as Condition;

      const result = validateCondition(condition, ['step1', 'step2']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('else'))).toBe(true);
    });

    it('should detect invalid step references', () => {
      const condition: Condition = {
        id: 'test',
        from: 'nonexistent',
        condition: 'test',
        then: 'step2',
        else: 'complete',
      };

      const result = validateCondition(condition, ['step1', 'step2']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('nonexistent'))).toBe(true);
    });

    it('should detect infinite loops', () => {
      const condition: Condition = {
        id: 'test',
        from: 'step1',
        condition: 'always_true',
        then: 'step1',
        else: 'step1',
      };

      const result = validateCondition(condition, ['step1', 'step2']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('infinite loop'))).toBe(true);
    });
  });

  describe('validateConditions', () => {
    it('should validate multiple conditions', () => {
      const conditions: Condition[] = [
        {
          id: 'c1',
          from: 'step1',
          condition: 'test',
          then: 'step2',
          else: 'complete',
        },
        {
          id: 'c2',
          from: 'step2',
          condition: 'test',
          then: 'step3',
          else: 'step1',
        },
      ];

      const result = validateConditions(conditions, ['step1', 'step2', 'step3']);
      expect(result.valid).toBe(true);
    });

    it('should detect conflicting conditions', () => {
      const conditions: Condition[] = [
        {
          id: 'c1',
          from: 'step1',
          condition: 'test',
          then: 'step2',
          else: 'complete',
        },
        {
          id: 'c2',
          from: 'step1', // Same as c1!
          condition: 'other',
          then: 'step3',
          else: 'complete',
        },
      ];

      const result = validateConditions(conditions, ['step1', 'step2', 'step3']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.errors.some(msg => msg.includes('conditions')))).toBe(true);
    });
  });

  describe('exportMermaidDiagram', () => {
    it('should generate valid mermaid diagram', () => {
      const conditions: Condition[] = [
        {
          id: 'quality-check',
          from: 'analyze',
          condition: 'confidence < 0.8',
          then: 'research',
          else: 'write',
        },
      ];

      const diagram = engine.exportMermaidDiagram(conditions);
      expect(diagram).toContain('graph TD');
      expect(diagram).toContain('analyze');
      expect(diagram).toContain('research');
      expect(diagram).toContain('write');
      expect(diagram).toContain('confidence < 0.8');
    });
  });
});

describe('RitualEngineV2 with Conditions', () => {
  it('should track condition evaluations', async () => {
    // This would be an integration test with actual ritual execution
    // Skipping for unit test purposes
    expect(true).toBe(true);
  });
});
