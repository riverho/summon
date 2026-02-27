import { z } from 'zod';
import { UserPreferences } from '../preferences/index.js';

// ============================================================================
// Advanced Guardrail Schemas
// ============================================================================

/**
 * Content policy - what content is allowed/blocked
 */
export const ContentPolicySchema = z.object({
  blocked_topics: z.array(z.string()).default([]),
  require_disclaimers: z.array(z.string()).default([]),
  banned_words: z.array(z.string()).default([]),
  sensitive_patterns: z.array(z.object({
    pattern: z.string(),
    description: z.string(),
    severity: z.enum(['warning', 'error']).default('warning'),
  })).default([]),
});

export type ContentPolicy = z.infer<typeof ContentPolicySchema>;

/**
 * Tool policy - which tools can be used
 */
export const ToolPolicySchema = z.object({
  allowed: z.array(z.string()).default([]),
  blocked: z.array(z.string()).default([]),
  require_approval: z.array(z.string()).default([]),
  max_tool_calls_per_run: z.number().default(50),
  max_tool_calls_per_type: z.record(z.string(), z.number()).default({}),
});

export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

/**
 * Cost policy - spending controls
 */
export const CostPolicySchema = z.object({
  max_per_run: z.number().default(0.50),
  max_per_day: z.number().default(5.00),
  max_per_month: z.number().default(50.00),
  alert_threshold: z.number().default(0.25),
  currency: z.enum(['USD', 'EUR', 'GBP']).default('USD'),
});

export type CostPolicy = z.infer<typeof CostPolicySchema>;

/**
 * Quality policy - response quality controls
 */
export const QualityPolicySchema = z.object({
  min_response_length: z.number().default(10),
  max_response_length: z.number().default(10000),
  require_sources: z.boolean().default(false),
  require_code_blocks: z.boolean().default(false),
  ban_words: z.array(z.string()).default(['guarantee', 'always', 'never']),
  required_sections: z.array(z.string()).default([]),
});

export type QualityPolicy = z.infer<typeof QualityPolicySchema>;

/**
 * Time policy - execution time controls
 */
export const TimePolicySchema = z.object({
  max_total_time: z.number().default(5 * 60), // 5 minutes in seconds
  max_tool_time: z.number().default(30), // 30 seconds per tool
  max_iteration_time: z.number().default(60), // 60 seconds per iteration
  pause_after: z.array(z.enum(['tool_error', 'high_cost', 'timeout', 'warning'])).default([]),
  auto_abort_after: z.number().optional(), // Auto abort after N seconds of inactivity
});

export type TimePolicy = z.infer<typeof TimePolicySchema>;

/**
 * Complete advanced guardrails configuration
 */
export const AdvancedGuardrailsSchema = z.object({
  version: z.string().default('2.0.0'),
  content_policy: ContentPolicySchema,
  tool_policy: ToolPolicySchema,
  cost_policy: CostPolicySchema,
  quality_policy: QualityPolicySchema,
  time_policy: TimePolicySchema,
  // Emergency stop
  emergency_stop_phrases: z.array(z.string()).default(['STOP', 'HALT', 'ABORT']),
  // Logging
  log_all_violations: z.boolean().default(true),
  notify_on_violation: z.boolean().default(false),
});

export type AdvancedGuardrails = z.infer<typeof AdvancedGuardrailsSchema>;

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_ADVANCED_GUARDRAILS: AdvancedGuardrails = {
  version: '2.0.0',
  content_policy: {
    blocked_topics: [],
    require_disclaimers: [],
    banned_words: [],
    sensitive_patterns: [],
  },
  tool_policy: {
    allowed: [],
    blocked: [],
    require_approval: [],
    max_tool_calls_per_run: 50,
    max_tool_calls_per_type: {},
  },
  cost_policy: {
    max_per_run: 0.50,
    max_per_day: 5.00,
    max_per_month: 50.00,
    alert_threshold: 0.25,
    currency: 'USD',
  },
  quality_policy: {
    min_response_length: 10,
    max_response_length: 10000,
    require_sources: false,
    require_code_blocks: false,
    ban_words: ['guarantee', 'always', 'never'],
    required_sections: [],
  },
  time_policy: {
    max_total_time: 300,
    max_tool_time: 30,
    max_iteration_time: 60,
    pause_after: [],
  },
  emergency_stop_phrases: ['STOP', 'HALT', 'ABORT'],
  log_all_violations: true,
  notify_on_violation: false,
};

// ============================================================================
// Guardrail Engine
// ============================================================================

export interface GuardrailCheck {
  policy: string;
  rule: string;
  passed: boolean;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

export interface GuardrailCheckResult {
  passed: boolean;
  checks: GuardrailCheck[];
  errors: GuardrailCheck[];
  warnings: GuardrailCheck[];
  should_pause: boolean;
  should_abort: boolean;
}

export interface GuardrailContext {
  userPreferences: UserPreferences;
  guardrails: AdvancedGuardrails;
  sessionId?: string;
  ritualId?: string;
  startTime: number;
  currentCost: number;
  dailyCost: number;
  toolCalls: number;
  toolCallsByType: Record<string, number>;
}

/**
 * Advanced Guardrail Engine - validates against all policies
 */
export class GuardrailEngine {
  private context: GuardrailContext;
  private violations: GuardrailCheck[] = [];

  constructor(context: GuardrailContext) {
    this.context = context;
  }

  /**
   * Check all guardrails
   */
  checkAll(): GuardrailCheckResult {
    const checks: GuardrailCheck[] = [
      ...this.checkContentPolicy(),
      ...this.checkToolPolicy(),
      ...this.checkCostPolicy(),
      ...this.checkTimePolicy(),
    ];

    const errors = checks.filter(c => c.severity === 'error' && !c.passed);
    const warnings = checks.filter(c => c.severity === 'warning' && !c.passed);

    const shouldAbort = errors.length > 0;
    const shouldPause = shouldAbort || this.shouldPauseAfterViolation(checks);

    // Track violations
    this.violations.push(...errors, ...warnings);

    return {
      passed: errors.length === 0,
      checks,
      errors,
      warnings,
      should_pause: shouldPause,
      should_abort: shouldAbort,
    };
  }

  /**
   * Check content against content policy
   */
  checkContent(content: string): GuardrailCheckResult {
    const checks: GuardrailCheck[] = [];
    const policy = this.context.guardrails.content_policy;

    // Check banned words
    for (const word of policy.banned_words) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = content.match(regex);
      if (matches) {
        checks.push({
          policy: 'content',
          rule: 'banned_words',
          passed: false,
          severity: 'warning',
          message: `Content contains banned word: "${word}"`,
          details: { word, count: matches.length },
        });
      }
    }

    // Check sensitive patterns
    for (const pattern of policy.sensitive_patterns) {
      const regex = new RegExp(pattern.pattern, 'gi');
      if (regex.test(content)) {
        checks.push({
          policy: 'content',
          rule: 'sensitive_pattern',
          passed: false,
          severity: pattern.severity,
          message: pattern.description,
          details: { pattern: pattern.pattern },
        });
      }
    }

    const errors = checks.filter(c => c.severity === 'error');
    
    return {
      passed: errors.length === 0,
      checks,
      errors,
      warnings: checks.filter(c => c.severity === 'warning'),
      should_pause: errors.length > 0 || policy.require_disclaimers.length > 0,
      should_abort: errors.length > 0,
    };
  }

  /**
   * Check quality of a response
   */
  checkQuality(response: string): GuardrailCheckResult {
    const checks: GuardrailCheck[] = [];
    const policy = this.context.guardrails.quality_policy;

    // Check length
    if (response.length < policy.min_response_length) {
      checks.push({
        policy: 'quality',
        rule: 'min_length',
        passed: false,
        severity: 'warning',
        message: `Response too short (${response.length} < ${policy.min_response_length})`,
        details: { length: response.length, min: policy.min_response_length },
      });
    }

    if (response.length > policy.max_response_length) {
      checks.push({
        policy: 'quality',
        rule: 'max_length',
        passed: false,
        severity: 'warning',
        message: `Response too long (${response.length} > ${policy.max_response_length})`,
        details: { length: response.length, max: policy.max_response_length },
      });
    }

    // Check banned words
    for (const word of policy.ban_words) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      if (regex.test(response)) {
        checks.push({
          policy: 'quality',
          rule: 'banned_words',
          passed: false,
          severity: 'warning',
          message: `Response contains discouraged word: "${word}"`,
          details: { word },
        });
      }
    }

    // Check for sources if required
    if (policy.require_sources && !this.hasSources(response)) {
      checks.push({
        policy: 'quality',
        rule: 'require_sources',
        passed: false,
        severity: 'warning',
        message: 'Response is missing required sources/citations',
      });
    }

    // Check for code blocks if required
    if (policy.require_code_blocks && !response.includes('```')) {
      checks.push({
        policy: 'quality',
        rule: 'require_code_blocks',
        passed: false,
        severity: 'warning',
        message: 'Response is missing required code blocks',
      });
    }

    const errors = checks.filter(c => c.severity === 'error');
    
    return {
      passed: errors.length === 0,
      checks,
      errors,
      warnings: checks.filter(c => c.severity === 'warning'),
      should_pause: false,
      should_abort: false,
    };
  }

  /**
   * Check if a tool is allowed
   */
  checkTool(toolName: string): GuardrailCheck {
    const policy = this.context.guardrails.tool_policy;

    // Check blocked list first
    if (policy.blocked.includes(toolName)) {
      return {
        policy: 'tool',
        rule: 'blocked',
        passed: false,
        severity: 'error',
        message: `Tool "${toolName}" is blocked`,
      };
    }

    // Check if there's an allowed list and tool is not in it
    if (policy.allowed.length > 0 && !policy.allowed.includes(toolName)) {
      return {
        policy: 'tool',
        rule: 'not_allowed',
        passed: false,
        severity: 'error',
        message: `Tool "${toolName}" is not in the allowed list`,
      };
    }

    // Check tool call limits
    const currentCalls = this.context.toolCallsByType[toolName] || 0;
    const maxCalls = policy.max_tool_calls_per_type[toolName];
    if (maxCalls !== undefined && currentCalls >= maxCalls) {
      return {
        policy: 'tool',
        rule: 'max_calls_exceeded',
        passed: false,
        severity: 'error',
        message: `Tool "${toolName}" exceeded max calls (${currentCalls}/${maxCalls})`,
        details: { tool: toolName, current: currentCalls, max: maxCalls },
      };
    }

    // Check approval requirement
    if (policy.require_approval.includes(toolName)) {
      return {
        policy: 'tool',
        rule: 'requires_approval',
        passed: true,
        severity: 'info',
        message: `Tool "${toolName}" requires user approval`,
        details: { requires_approval: true },
      };
    }

    return {
      policy: 'tool',
      rule: 'allowed',
      passed: true,
      severity: 'info',
      message: `Tool "${toolName}" is allowed`,
    };
  }

  /**
   * Get all violations logged so far
   */
  getViolations(): GuardrailCheck[] {
    return [...this.violations];
  }

  // Private helpers

  private checkContentPolicy(): GuardrailCheck[] {
    return []; // Content checked separately per-message
  }

  private checkToolPolicy(): GuardrailCheck[] {
    const checks: GuardrailCheck[] = [];
    const policy = this.context.guardrails.tool_policy;

    // Check total tool calls
    if (this.context.toolCalls > policy.max_tool_calls_per_run) {
      checks.push({
        policy: 'tool',
        rule: 'max_total_calls',
        passed: false,
        severity: 'error',
        message: `Total tool calls exceeded (${this.context.toolCalls}/${policy.max_tool_calls_per_run})`,
        details: { current: this.context.toolCalls, max: policy.max_tool_calls_per_run },
      });
    }

    return checks;
  }

  private checkCostPolicy(): GuardrailCheck[] {
    const checks: GuardrailCheck[] = [];
    const policy = this.context.guardrails.cost_policy;

    // Check per-run cost
    if (this.context.currentCost > policy.max_per_run) {
      checks.push({
        policy: 'cost',
        rule: 'max_per_run',
        passed: false,
        severity: 'error',
        message: `Run cost exceeded ($${this.context.currentCost.toFixed(2)}/$${policy.max_per_run})`,
        details: { current: this.context.currentCost, max: policy.max_per_run },
      });
    }

    // Check alert threshold
    if (this.context.currentCost > policy.alert_threshold) {
      checks.push({
        policy: 'cost',
        rule: 'alert_threshold',
        passed: true,
        severity: 'warning',
        message: `Cost alert: $${this.context.currentCost.toFixed(2)} (threshold: $${policy.alert_threshold})`,
        details: { current: this.context.currentCost, threshold: policy.alert_threshold },
      });
    }

    // Check daily cost
    if (this.context.dailyCost > policy.max_per_day) {
      checks.push({
        policy: 'cost',
        rule: 'max_per_day',
        passed: false,
        severity: 'error',
        message: `Daily cost exceeded ($${this.context.dailyCost.toFixed(2)}/$${policy.max_per_day})`,
        details: { current: this.context.dailyCost, max: policy.max_per_day },
      });
    }

    return checks;
  }

  private checkTimePolicy(): GuardrailCheck[] {
    const checks: GuardrailCheck[] = [];
    const policy = this.context.guardrails.time_policy;

    const elapsedSeconds = (Date.now() - this.context.startTime) / 1000;

    if (elapsedSeconds > policy.max_total_time) {
      checks.push({
        policy: 'time',
        rule: 'max_total_time',
        passed: false,
        severity: 'error',
        message: `Total time exceeded (${elapsedSeconds.toFixed(1)}s/${policy.max_total_time}s)`,
        details: { elapsed: elapsedSeconds, max: policy.max_total_time },
      });
    }

    return checks;
  }

  private shouldPauseAfterViolation(checks: GuardrailCheck[]): boolean {
    const policy = this.context.guardrails.time_policy;
    
    for (const trigger of policy.pause_after) {
      if (trigger === 'tool_error' && checks.some(c => c.policy === 'tool' && !c.passed)) {
        return true;
      }
      if (trigger === 'high_cost' && checks.some(c => c.policy === 'cost' && c.severity === 'warning')) {
        return true;
      }
      if (trigger === 'timeout' && checks.some(c => c.policy === 'time')) {
        return true;
      }
      if (trigger === 'warning' && checks.some(c => c.severity === 'warning')) {
        return true;
      }
    }
    
    return false;
  }

  private hasSources(content: string): boolean {
    const sourcePatterns = [
      /\[.*?\]\(https?:\/\/.*?\)/i,  // Markdown links
      /https?:\/\/\S+/i,               // Raw URLs
      /source[:\s]/i,                  // "Source:" mentions
      /\(see .+?\)/i,                  // "(see ...)"
      /\[\d+\]/,                        // Citation numbers
      /reference/i,                     // Reference mentions
    ];

    return sourcePatterns.some(pattern => pattern.test(content));
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create guardrails from user preferences
 */
export function createGuardrailsFromPreferences(
  preferences: UserPreferences
): AdvancedGuardrails {
  return {
    ...DEFAULT_ADVANCED_GUARDRAILS,
    cost_policy: {
      ...DEFAULT_ADVANCED_GUARDRAILS.cost_policy,
      max_per_run: preferences.safety.max_cost_per_run,
    },
    time_policy: {
      ...DEFAULT_ADVANCED_GUARDRAILS.time_policy,
      max_total_time: preferences.safety.max_time_per_run * 60,
    },
    tool_policy: {
      ...DEFAULT_ADVANCED_GUARDRAILS.tool_policy,
      allowed: preferences.safety.allowed_tools,
    },
    content_policy: {
      ...DEFAULT_ADVANCED_GUARDRAILS.content_policy,
      blocked_topics: preferences.safety.blocked_topics,
    },
    quality_policy: {
      ...DEFAULT_ADVANCED_GUARDRAILS.quality_policy,
      require_sources: preferences.format.include_sources,
    },
  };
}

/**
 * Load guardrails from a YAML file
 */
export async function loadGuardrails(yamlContent: string): Promise<AdvancedGuardrails> {
  try {
    const { parse } = await import('yaml');
    const parsed = parse(yamlContent);
    const result = AdvancedGuardrailsSchema.safeParse(parsed);
    
    if (result.success) {
      return result.data;
    }
    
    // Merge with defaults for partial configs
    return mergeGuardrails(DEFAULT_ADVANCED_GUARDRAILS, parsed);
  } catch {
    return { ...DEFAULT_ADVANCED_GUARDRAILS };
  }
}

/**
 * Merge partial guardrails with defaults
 */
export function mergeGuardrails(
  defaults: AdvancedGuardrails,
  overrides: Partial<AdvancedGuardrails>
): AdvancedGuardrails {
  return {
    ...defaults,
    ...overrides,
    content_policy: { ...defaults.content_policy, ...overrides.content_policy },
    tool_policy: { ...defaults.tool_policy, ...overrides.tool_policy },
    cost_policy: { ...defaults.cost_policy, ...overrides.cost_policy },
    quality_policy: { ...defaults.quality_policy, ...overrides.quality_policy },
    time_policy: { ...defaults.time_policy, ...overrides.time_policy },
  };
}
