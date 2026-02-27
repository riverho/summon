import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';

// ============================================================================
// A/B Testing Schemas
// ============================================================================

/**
 * Variant configuration
 */
export const VariantConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  weight: z.number().min(0).max(1).default(0.5),
  config: z.record(z.string(), z.any()),
  active: z.boolean().default(true),
});

export type VariantConfig = z.infer<typeof VariantConfigSchema>;

/**
 * Test metrics to track
 */
export const TestMetricSchema = z.object({
  name: z.string(),
  type: z.enum(['count', 'average', 'rate', 'duration']).default('count'),
  higher_is_better: z.boolean().default(true),
});

export type TestMetric = z.infer<typeof TestMetricSchema>;

/**
 * Test result for a single variant
 */
export const VariantResultSchema = z.object({
  variantId: z.string(),
  assignments: z.number().default(0),
  completions: z.number().default(0),
  failures: z.number().default(0),
  metrics: z.record(z.string(), z.object({
    sum: z.number(),
    count: z.number(),
    average: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
  })),
  userRatings: z.array(z.number()),
});

export type VariantResult = z.infer<typeof VariantResultSchema>;

/**
 * A/B Test definition
 */
export const ABTestSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  ritualId: z.string(),
  status: z.enum(['draft', 'running', 'paused', 'completed']).default('draft'),
  
  // Variants
  variants: z.array(VariantConfigSchema).min(2),
  
  // Metrics to track
  metrics: z.array(TestMetricSchema).default([]),
  
  // Results
  results: z.record(z.string(), VariantResultSchema).default({}),
  
  // Configuration
  minSampleSize: z.number().default(30),
  maxSampleSize: z.number().optional(),
  confidenceLevel: z.number().default(0.95),
  autoPromote: z.boolean().default(false),
  
  // Timing
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  
  // Winner
  winner: z.string().optional(),
  winnerConfidence: z.number().optional(),
});

export type ABTest = z.infer<typeof ABTestSchema>;

/**
 * User assignment to a variant
 */
export const UserAssignmentSchema = z.object({
  userId: z.string(),
  testId: z.string(),
  variantId: z.string(),
  assignedAt: z.string(),
  completed: z.boolean().default(false),
  rated: z.boolean().default(false),
});

export type UserAssignment = z.infer<typeof UserAssignmentSchema>;

/**
 * Test report
 */
export const TestReportSchema = z.object({
  testId: z.string(),
  status: z.enum(['running', 'completed', 'insufficient_data']),
  variants: z.array(z.object({
    id: z.string(),
    name: z.string(),
    assignments: z.number(),
    completionRate: z.number(),
    averageRating: z.number().optional(),
    metricScores: z.record(z.string(), z.number()),
  })),
  winner: z.string().optional(),
  confidence: z.number().optional(),
  recommendation: z.string(),
});

export type TestReport = z.infer<typeof TestReportSchema>;

// ============================================================================
// Default Metrics
// ============================================================================

export const DEFAULT_METRICS: TestMetric[] = [
  { name: 'user_rating', type: 'average', higher_is_better: true },
  { name: 'completion_rate', type: 'rate', higher_is_better: true },
  { name: 'token_efficiency', type: 'average', higher_is_better: true },
  { name: 'response_time', type: 'duration', higher_is_better: false },
  { name: 'cost', type: 'average', higher_is_better: false },
];

// ============================================================================
// Paths
// ============================================================================

const OPENCLAW_DIR = '.openclaw';
const AB_TEST_DIR = 'ab-tests';
const ASSIGNMENTS_FILE = 'assignments.json';

function getABTestDir(): string {
  return join(homedir(), OPENCLAW_DIR, AB_TEST_DIR);
}

function getTestPath(testId: string): string {
  return join(getABTestDir(), `${testId}.yaml`);
}

function getAssignmentsPath(): string {
  return join(getABTestDir(), ASSIGNMENTS_FILE);
}

// ============================================================================
// A/B Test Manager
// ============================================================================

export class ABTestManager {
  private assignments: Map<string, UserAssignment> = new Map();

  constructor() {
    this.loadAssignments();
  }

  // ========================================================================
  // Test CRUD
  // ========================================================================

  /**
   * Create a new A/B test
   */
  createTest(config: Omit<ABTest, 'id' | 'createdAt' | 'results'>): ABTest {
    const id = `abtest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    // Initialize results for each variant
    const results: Record<string, VariantResult> = {};
    for (const variant of config.variants) {
      results[variant.id] = {
        variantId: variant.id,
        assignments: 0,
        completions: 0,
        failures: 0,
        metrics: {},
        userRatings: [],
      };
    }

    const test: ABTest = {
      ...config,
      id,
      createdAt: now,
      results,
    };

    this.saveTest(test);
    return test;
  }

  /**
   * Load a test from disk
   */
  loadTest(testId: string): ABTest | null {
    const testPath = getTestPath(testId);
    
    if (!existsSync(testPath)) {
      return null;
    }

    try {
      const content = readFileSync(testPath, 'utf-8');
      const parsed = parseYaml(content);
      const result = ABTestSchema.safeParse(parsed);
      
      if (result.success) {
        return result.data;
      }
      
      console.warn(`Invalid test file: ${testId}`);
      return null;
    } catch (error) {
      console.error(`Failed to load test ${testId}:`, error);
      return null;
    }
  }

  /**
   * Save a test to disk
   */
  saveTest(test: ABTest): boolean {
    try {
      const testDir = getABTestDir();
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }

      writeFileSync(getTestPath(test.id), stringifyYaml(test), 'utf-8');
      return true;
    } catch (error) {
      console.error('Failed to save test:', error);
      return false;
    }
  }

  /**
   * List all tests
   */
  listTests(): ABTest[] {
    const testDir = getABTestDir();
    
    if (!existsSync(testDir)) {
      return [];
    }

    const tests: ABTest[] = [];
    const files = require('fs').readdirSync(testDir);
    
    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const testId = file.replace(/\.ya?ml$/, '');
        const test = this.loadTest(testId);
        if (test) {
          tests.push(test);
        }
      }
    }

    return tests.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Get tests for a specific ritual
   */
  getTestsForRitual(ritualId: string): ABTest[] {
    return this.listTests().filter(t => t.ritualId === ritualId);
  }

  // ========================================================================
  // Assignment
  // ========================================================================

  /**
   * Assign a user to a variant for a test
   */
  assignVariant(testId: string, userId: string): VariantConfig | null {
    const test = this.loadTest(testId);
    if (!test) return null;

    // Check if user already assigned
    const existingKey = `${userId}:${testId}`;
    if (this.assignments.has(existingKey)) {
      const assignment = this.assignments.get(existingKey)!;
      const variant = test.variants.find(v => v.id === assignment.variantId);
      return variant || null;
    }

    // Filter active variants
    const activeVariants = test.variants.filter(v => v.active);
    if (activeVariants.length === 0) return null;

    // Weighted random assignment
    const totalWeight = activeVariants.reduce((sum, v) => sum + v.weight, 0);
    let random = Math.random() * totalWeight;
    
    let selectedVariant = activeVariants[0];
    for (const variant of activeVariants) {
      random -= variant.weight;
      if (random <= 0) {
        selectedVariant = variant;
        break;
      }
    }

    // Record assignment
    const assignment: UserAssignment = {
      userId,
      testId,
      variantId: selectedVariant.id,
      assignedAt: new Date().toISOString(),
      completed: false,
      rated: false,
    };

    this.assignments.set(existingKey, assignment);
    this.saveAssignments();

    // Update test results
    test.results[selectedVariant.id].assignments++;
    this.saveTest(test);

    return selectedVariant;
  }

  /**
   * Get user's assigned variant
   */
  getUserVariant(testId: string, userId: string): VariantConfig | null {
    const test = this.loadTest(testId);
    if (!test) return null;

    const assignment = this.assignments.get(`${userId}:${testId}`);
    if (!assignment) return null;

    return test.variants.find(v => v.id === assignment.variantId) || null;
  }

  // ========================================================================
  // Recording Outcomes
  // ========================================================================

  /**
   * Record an outcome for a variant
   */
  recordOutcome(
    testId: string,
    variantId: string,
    metrics: Record<string, number>,
    success = true,
    userRating?: number
  ): void {
    const test = this.loadTest(testId);
    if (!test) return;

    const result = test.results[variantId];
    if (!result) return;

    if (success) {
      result.completions++;
    } else {
      result.failures++;
    }

    // Update metrics
    for (const [name, value] of Object.entries(metrics)) {
      if (!result.metrics[name]) {
        result.metrics[name] = {
          sum: 0,
          count: 0,
          average: 0,
        };
      }

      const metric = result.metrics[name];
      metric.sum += value;
      metric.count++;
      metric.average = metric.sum / metric.count;
      
      if (metric.min === undefined || value < metric.min) {
        metric.min = value;
      }
      if (metric.max === undefined || value > metric.max) {
        metric.max = value;
      }
    }

    // Record user rating
    if (userRating !== undefined) {
      result.userRatings.push(userRating);
    }

    this.saveTest(test);
  }

  /**
   * Record completion with rating
   */
  recordCompletion(
    testId: string,
    userId: string,
    metrics: Record<string, number>,
    success = true,
    rating?: number
  ): void {
    const assignment = this.assignments.get(`${userId}:${testId}`);
    if (!assignment) return;

    this.recordOutcome(testId, assignment.variantId, metrics, success, rating);
    
    assignment.completed = true;
    if (rating !== undefined) {
      assignment.rated = true;
    }
    
    this.saveAssignments();
  }

  // ========================================================================
  // Analysis
  // ========================================================================

  /**
   * Analyze test results and generate report
   */
  analyzeResults(testId: string): TestReport {
    const test = this.loadTest(testId);
    if (!test) {
      return {
        testId,
        status: 'insufficient_data',
        variants: [],
        recommendation: 'Test not found',
      };
    }

    const variants = test.variants.map(variant => {
      const result = test.results[variant.id];
      const avgRating = result.userRatings.length > 0
        ? result.userRatings.reduce((a, b) => a + b, 0) / result.userRatings.length
        : undefined;

      const metricScores: Record<string, number> = {};
      for (const [name, data] of Object.entries(result.metrics)) {
        metricScores[name] = data.average;
      }

      return {
        id: variant.id,
        name: variant.name,
        assignments: result.assignments,
        completionRate: result.assignments > 0 ? result.completions / result.assignments : 0,
        averageRating: avgRating,
        metricScores,
      };
    });

    // Check if we have enough data
    const totalAssignments = variants.reduce((sum, v) => sum + v.assignments, 0);
    if (totalAssignments < test.minSampleSize) {
      return {
        testId,
        status: 'insufficient_data',
        variants,
        recommendation: `Need ${test.minSampleSize - totalAssignments} more samples`,
      };
    }

    // Determine winner based on metrics
    const winner = this.determineWinner(test, variants);
    
    return {
      testId,
      status: test.status === 'completed' ? 'completed' : 'running',
      variants,
      winner: winner?.id,
      confidence: winner?.confidence,
      recommendation: winner 
        ? `Variant "${winner.name}" is performing best with ${Math.round(winner.confidence! * 100)}% confidence`
        : 'No clear winner yet',
    };
  }

  /**
   * Promote the winning variant
   */
  async promoteWinner(testId: string): Promise<{ success: boolean; message: string }> {
    const test = this.loadTest(testId);
    if (!test) {
      return { success: false, message: 'Test not found' };
    }

    const report = this.analyzeResults(testId);
    
    if (!report.winner) {
      return { success: false, message: 'No winner determined yet' };
    }

    // Deactivate all other variants
    for (const variant of test.variants) {
      variant.active = variant.id === report.winner;
    }

    test.status = 'completed';
    test.completedAt = new Date().toISOString();
    test.winner = report.winner;
    test.winnerConfidence = report.confidence;

    this.saveTest(test);

    return {
      success: true,
      message: `Promoted "${test.variants.find(v => v.id === report.winner)?.name}" as the winner`,
    };
  }

  /**
   * Start a test
   */
  startTest(testId: string): boolean {
    const test = this.loadTest(testId);
    if (!test || test.status !== 'draft') return false;

    test.status = 'running';
    test.startedAt = new Date().toISOString();
    return this.saveTest(test);
  }

  /**
   * Pause a test
   */
  pauseTest(testId: string): boolean {
    const test = this.loadTest(testId);
    if (!test || test.status !== 'running') return false;

    test.status = 'paused';
    return this.saveTest(test);
  }

  // ========================================================================
  // Private Helpers
  // ========================================================================

  private loadAssignments(): void {
    const path = getAssignmentsPath();
    if (!existsSync(path)) return;

    try {
      const content = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(content);
      
      for (const [key, value] of Object.entries(parsed)) {
        const result = UserAssignmentSchema.safeParse(value);
        if (result.success) {
          this.assignments.set(key, result.data);
        }
      }
    } catch (error) {
      console.error('Failed to load assignments:', error);
    }
  }

  private saveAssignments(): boolean {
    try {
      const testDir = getABTestDir();
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }

      const obj: Record<string, UserAssignment> = {};
      for (const [key, value] of this.assignments) {
        obj[key] = value;
      }

      writeFileSync(getAssignmentsPath(), JSON.stringify(obj, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error('Failed to save assignments:', error);
      return false;
    }
  }

  private determineWinner(
    test: ABTest,
    variantData: TestReport['variants']
  ): { id: string; name: string; confidence: number } | null {
    if (variantData.length < 2) return null;

    // Score each variant based on metrics
    const scores = variantData.map(v => {
      let score = 0;
      let weight = 0;

      // Completion rate (30%)
      score += v.completionRate * 0.3;
      weight += 0.3;

      // User rating (40%)
      if (v.averageRating) {
        score += (v.averageRating / 5) * 0.4;
        weight += 0.4;
      }

      // Other metrics (30%)
      for (const metric of test.metrics) {
        const value = v.metricScores[metric.name];
        if (value !== undefined) {
          const normalized = metric.higher_is_better ? value : 1 / (value + 1);
          score += normalized * 0.1;
          weight += 0.1;
        }
      }

      return {
        id: v.id,
        name: v.name,
        score: weight > 0 ? score / weight : 0,
        assignments: v.assignments,
      };
    });

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Calculate confidence based on sample size and score difference
    const best = scores[0];
    const second = scores[1];
    const scoreDiff = best.score - second.score;
    const sampleConfidence = Math.min(best.assignments / test.minSampleSize, 1);
    const confidence = Math.min(scoreDiff * 2 * sampleConfidence, 0.99);

    if (confidence > 0.7) {
      return {
        id: best.id,
        name: best.name,
        confidence,
      };
    }

    return null;
  }
}

// ============================================================================
// Global Instance
// ============================================================================

let globalTestManager: ABTestManager | null = null;

export function getABTestManager(): ABTestManager {
  if (!globalTestManager) {
    globalTestManager = new ABTestManager();
  }
  return globalTestManager;
}

export function setABTestManager(manager: ABTestManager): void {
  globalTestManager = manager;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a standard A/B test for a ritual
 */
export function createStandardTest(
  ritualId: string,
  controlConfig: Record<string, unknown>,
  treatmentConfig: Record<string, unknown>,
  name?: string
): ABTest {
  const manager = getABTestManager();
  
  return manager.createTest({
    name: name || `A/B Test for ${ritualId}`,
    ritualId,
    status: 'draft',
    variants: [
      {
        id: 'control',
        name: 'Control (Current)',
        weight: 0.5,
        config: controlConfig,
        active: true,
      },
      {
        id: 'treatment',
        name: 'Treatment (New)',
        weight: 0.5,
        config: treatmentConfig,
        active: true,
      },
    ],
    metrics: DEFAULT_METRICS,
    minSampleSize: 30,
    confidenceLevel: 0.95,
    autoPromote: false,
  });
}
