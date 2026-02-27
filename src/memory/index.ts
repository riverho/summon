import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import { UserPreferences, StylePreferences, FormatPreferences } from '../preferences/index.js';

// ============================================================================
// Memory Schemas
// ============================================================================

/**
 * Summarized interaction for memory
 */
export const SummarizedInteractionSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  query: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  ritualId: z.string().optional(),
  success: z.boolean(),
  rating: z.number().min(1).max(5).optional(),
  tokensUsed: z.number(),
  cost: z.number(),
});

export type SummarizedInteraction = z.infer<typeof SummarizedInteractionSchema>;

/**
 * Ritual modification that worked well
 */
export const RitualModificationSchema = z.object({
  id: z.string(),
  ritualId: z.string(),
  timestamp: z.string(),
  description: z.string(),
  change: z.record(z.string(), z.any()),
  successRate: z.number(),
  appliedCount: z.number(),
});

export type RitualModification = z.infer<typeof RitualModificationSchema>;

/**
 * Training pattern - what works/doesn't work
 */
export const TrainingPatternSchema = z.object({
  pattern: z.string(),
  type: z.enum(['success', 'failure', 'preference']),
  count: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  examples: z.array(z.string()),
});

export type TrainingPattern = z.infer<typeof TrainingPatternSchema>;

/**
 * Learned preferences from usage patterns
 */
export const LearnedPreferencesSchema = z.object({
  style: z.object({
    response_length: z.enum(['concise', 'detailed', 'exhaustive']).optional(),
    tone: z.enum(['formal', 'casual', 'professional']).optional(),
    reasoning: z.enum(['hidden', 'brief', 'thorough']).optional(),
  }),
  format: z.object({
    use_tables: z.boolean().optional(),
    use_bullets: z.boolean().optional(),
    include_sources: z.boolean().optional(),
  }),
  preferredModels: z.array(z.string()),
  preferredTools: z.array(z.string()),
  avoidedTools: z.array(z.string()),
});

export type LearnedPreferences = z.infer<typeof LearnedPreferencesSchema>;

/**
 * Ritual-specific overrides learned from experience
 */
export const RitualPreferenceOverrideSchema = z.object({
  ritualId: z.string(),
  modelPreference: z.string().optional(),
  temperatureOverride: z.number().optional(),
  maxIterationsOverride: z.number().optional(),
  customInstructions: z.string().optional(),
  effectivePromptAdditions: z.array(z.string()),
});

export type RitualPreferenceOverride = z.infer<typeof RitualPreferenceOverrideSchema>;

/**
 * Complete user memory structure
 */
export const UserMemorySchema = z.object({
  version: z.string().default('1.0.0'),
  userId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  
  // Learned from explicit preferences and behavior
  learnedPreferences: LearnedPreferencesSchema,
  
  // Ritual-specific learned preferences
  ritualOverrides: z.array(RitualPreferenceOverrideSchema),
  
  // Training patterns
  patterns: z.array(TrainingPatternSchema),
  
  // Summarized conversation history
  recentInteractions: z.array(SummarizedInteractionSchema),
  
  // Successful modifications
  successfulMods: z.array(RitualModificationSchema),
  
  // Stats
  stats: z.object({
    totalInteractions: z.number().default(0),
    totalSessions: z.number().default(0),
    totalTokensUsed: z.number().default(0),
    totalCost: z.number().default(0),
    averageRating: z.number().optional(),
    lastSessionDate: z.string().optional(),
  }),
});

export type UserMemory = z.infer<typeof UserMemorySchema>;

// ============================================================================
// Default Memory
// ============================================================================

export function createDefaultMemory(userId: string): UserMemory {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    userId,
    createdAt: now,
    updatedAt: now,
    learnedPreferences: {
      style: {},
      format: {},
      preferredModels: [],
      preferredTools: [],
      avoidedTools: [],
    },
    ritualOverrides: [],
    patterns: [],
    recentInteractions: [],
    successfulMods: [],
    stats: {
      totalInteractions: 0,
      totalSessions: 0,
      totalTokensUsed: 0,
      totalCost: 0,
    },
  };
}

// ============================================================================
// Paths
// ============================================================================

const OPENCLAW_DIR = '.openclaw';
const MEMORY_FILE = 'user-memory.json';

function getMemoryDir(): string {
  return join(homedir(), OPENCLAW_DIR);
}

function getMemoryPath(userId?: string): string {
  const basePath = getMemoryDir();
  if (userId) {
    return join(basePath, `memory-${userId}.json`);
  }
  return join(basePath, MEMORY_FILE);
}

// ============================================================================
// User Memory Manager
// ============================================================================

export class UserMemoryManager {
  private memory: UserMemory;
  private userId: string;
  private dirty = false;

  constructor(userId: string = 'default') {
    this.userId = userId;
    this.memory = this.load();
  }

  /**
   * Load memory from disk
   */
  private load(): UserMemory {
    const memoryPath = getMemoryPath(this.userId);
    
    if (!existsSync(memoryPath)) {
      return createDefaultMemory(this.userId);
    }

    try {
      const content = readFileSync(memoryPath, 'utf-8');
      const parsed = JSON.parse(content);
      const result = UserMemorySchema.safeParse(parsed);
      
      if (result.success) {
        return result.data;
      }
      
      // Merge with defaults for partial data
      return { ...createDefaultMemory(this.userId), ...parsed };
    } catch (error) {
      console.warn('Failed to load user memory, using defaults:', error);
      return createDefaultMemory(this.userId);
    }
  }

  /**
   * Save memory to disk
   */
  save(): boolean {
    try {
      const memoryDir = getMemoryDir();
      if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
      }

      this.memory.updatedAt = new Date().toISOString();
      writeFileSync(
        getMemoryPath(this.userId),
        JSON.stringify(this.memory, null, 2),
        'utf-8'
      );
      this.dirty = false;
      return true;
    } catch (error) {
      console.error('Failed to save user memory:', error);
      return false;
    }
  }

  /**
   * Get the full memory object
   */
  getMemory(): UserMemory {
    return { ...this.memory };
  }

  /**
   * Record a new interaction
   */
  recordInteraction(interaction: Omit<SummarizedInteraction, 'id'>): void {
    const id = `int_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    
    this.memory.recentInteractions.unshift({
      ...interaction,
      id,
    });

    // Keep only recent 100 interactions
    if (this.memory.recentInteractions.length > 100) {
      this.memory.recentInteractions = this.memory.recentInteractions.slice(0, 100);
    }

    // Update stats
    this.memory.stats.totalInteractions++;
    this.memory.stats.totalTokensUsed += interaction.tokensUsed || 0;
    this.memory.stats.totalCost += interaction.cost || 0;
    
    if (interaction.rating) {
      this.updateAverageRating(interaction.rating);
    }

    this.dirty = true;
  }

  /**
   * Record a training pattern
   */
  recordPattern(pattern: string, type: TrainingPattern['type'], example?: string): void {
    const existing = this.memory.patterns.find(p => p.pattern === pattern);
    const now = new Date().toISOString();

    if (existing) {
      existing.count++;
      existing.lastSeen = now;
      if (example) {
        existing.examples.push(example);
        if (existing.examples.length > 5) {
          existing.examples.shift();
        }
      }
    } else {
      this.memory.patterns.push({
        pattern,
        type,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        examples: example ? [example] : [],
      });
    }

    this.dirty = true;
  }

  /**
   * Record a successful ritual modification
   */
  recordSuccessfulMod(mod: Omit<RitualModification, 'id' | 'timestamp'>): void {
    const id = `mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    // Check if similar mod already exists
    const existing = this.memory.successfulMods.find(
      m => m.ritualId === mod.ritualId && 
           JSON.stringify(m.change) === JSON.stringify(mod.change)
    );

    if (existing) {
      existing.appliedCount++;
      existing.successRate = ((existing.successRate * (existing.appliedCount - 1)) + (mod.successRate || 1)) / existing.appliedCount;
    } else {
      this.memory.successfulMods.push({
        ...mod,
        id,
        timestamp: now,
      });
    }

    this.dirty = true;
  }

  /**
   * Learn from a user rating
   */
  learnFromRating(
    ritualId: string,
    rating: number,
    feedback?: string
  ): void {
    // Record success/failure pattern
    if (rating >= 4) {
      this.recordPattern('high_user_rating', 'success', ritualId);
    } else if (rating <= 2) {
      this.recordPattern('low_user_rating', 'failure', ritualId);
    }

    // Try to learn from feedback text
    if (feedback) {
      this.learnFromFeedback(feedback);
    }

    this.dirty = true;
  }

  /**
   * Get learned preferences that differ from defaults
   */
  getLearnedPreferences(): Partial<UserPreferences> {
    const learned: Partial<UserPreferences> = {};
    const lp = this.memory.learnedPreferences;

    if (Object.keys(lp.style).length > 0) {
      learned.style = lp.style as StylePreferences;
    }
    if (Object.keys(lp.format).length > 0) {
      learned.format = lp.format as FormatPreferences;
    }

    return learned;
  }

  /**
   * Get ritual-specific overrides
   */
  getRitualOverrides(ritualId: string): RitualPreferenceOverride | undefined {
    return this.memory.ritualOverrides.find(r => r.ritualId === ritualId);
  }

  /**
   * Set ritual-specific overrides
   */
  setRitualOverrides(overrides: RitualPreferenceOverride): void {
    const index = this.memory.ritualOverrides.findIndex(r => r.ritualId === overrides.ritualId);
    
    if (index >= 0) {
      this.memory.ritualOverrides[index] = overrides;
    } else {
      this.memory.ritualOverrides.push(overrides);
    }

    this.dirty = true;
  }

  /**
   * Get common failure patterns
   */
  getCommonFailures(limit = 5): string[] {
    return this.memory.patterns
      .filter(p => p.type === 'failure')
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(p => p.pattern);
  }

  /**
   * Get successful modifications for a ritual
   */
  getSuccessfulModsForRitual(ritualId: string): RitualModification[] {
    return this.memory.successfulMods
      .filter(m => m.ritualId === ritualId)
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Get recent interactions
   */
  getRecentInteractions(limit = 10): SummarizedInteraction[] {
    return this.memory.recentInteractions.slice(0, limit);
  }

  /**
   * Search interactions by query
   */
  searchInteractions(query: string): SummarizedInteraction[] {
    const lowerQuery = query.toLowerCase();
    return this.memory.recentInteractions.filter(
      i => 
        i.query.toLowerCase().includes(lowerQuery) ||
        i.summary.toLowerCase().includes(lowerQuery) ||
        i.tags.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get memory stats
   */
  getStats(): UserMemory['stats'] {
    return { ...this.memory.stats };
  }

  /**
   * Get context for a ritual (learned info that should be included)
   */
  getRitualContext(ritualId: string): string {
    const parts: string[] = [];

    // Add ritual-specific overrides
    const overrides = this.getRitualOverrides(ritualId);
    if (overrides?.customInstructions) {
      parts.push(`Previous instructions that worked well: ${overrides.customInstructions}`);
    }

    // Add successful modifications
    const mods = this.getSuccessfulModsForRitual(ritualId).slice(0, 3);
    if (mods.length > 0) {
      parts.push(`Successful modifications for this ritual:`);
      for (const mod of mods) {
        parts.push(`  - ${mod.description} (${Math.round(mod.successRate * 100)}% success)`);
      }
    }

    // Add common failure warnings
    const failures = this.getCommonFailures(3);
    if (failures.length > 0) {
      parts.push(`Watch out for these common issues:`);
      for (const failure of failures) {
        parts.push(`  - ${failure}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Start a new session
   */
  startSession(): void {
    this.memory.stats.totalSessions++;
    this.memory.stats.lastSessionDate = new Date().toISOString();
    this.dirty = true;
  }

  /**
   * Auto-save if dirty
   */
  autoSave(): boolean {
    if (this.dirty) {
      return this.save();
    }
    return true;
  }

  // Private helpers

  private updateAverageRating(newRating: number): void {
    const stats = this.memory.stats;
    const current = stats.averageRating || 0;
    const total = stats.totalInteractions;
    stats.averageRating = ((current * (total - 1)) + newRating) / total;
  }

  private learnFromFeedback(feedback: string): void {
    const lowerFeedback = feedback.toLowerCase();

    // Learn style preferences from feedback
    if (lowerFeedback.includes('too long') || lowerFeedback.includes('verbose')) {
      this.memory.learnedPreferences.style.response_length = 'concise';
      this.recordPattern('prefers_concise', 'preference');
    }
    if (lowerFeedback.includes('too short') || lowerFeedback.includes('brief')) {
      this.memory.learnedPreferences.style.response_length = 'detailed';
      this.recordPattern('prefers_detailed', 'preference');
    }
    if (lowerFeedback.includes('casual') || lowerFeedback.includes('friendly')) {
      this.memory.learnedPreferences.style.tone = 'casual';
      this.recordPattern('prefers_casual', 'preference');
    }
    if (lowerFeedback.includes('formal') || lowerFeedback.includes('professional')) {
      this.memory.learnedPreferences.style.tone = 'formal';
      this.recordPattern('prefers_formal', 'preference');
    }
    if (lowerFeedback.includes('source') || lowerFeedback.includes('citation')) {
      this.memory.learnedPreferences.format.include_sources = true;
      this.recordPattern('prefers_sources', 'preference');
    }
  }
}

// ============================================================================
// Global Instance
// ============================================================================

let globalMemoryManager: UserMemoryManager | null = null;

export function getUserMemoryManager(userId?: string): UserMemoryManager {
  if (!globalMemoryManager) {
    globalMemoryManager = new UserMemoryManager(userId);
  }
  return globalMemoryManager;
}

export function setUserMemoryManager(manager: UserMemoryManager): void {
  globalMemoryManager = manager;
}
