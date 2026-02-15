// Billing System — Credit Management & Tier Enforcement
// Handles user credits, quotas, and payment tracking

import { UserTier, TIER_CONFIGS, IDEType, AGENT_COSTS } from '../factory/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface CreditAccount {
  userId: string;
  tier: UserTier;
  balance: number;
  totalSpent: number;
  
  // Free tier quota tracking
  quota?: {
    monthlyCredits: number;
    usedThisMonth: number;
    resetsAt: Date;
  };
  
  // Transaction history (last 100)
  recentTransactions: CreditTransaction[];
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditTransaction {
  id: string;
  type: 'credit' | 'debit' | 'refund' | 'quota_reset';
  amount: number;
  balanceAfter: number;
  description: string;
  ritualId?: string;
  taskId?: string;
  agentType?: IDEType;
  timestamp: Date;
}

export interface UsageReport {
  period: { start: Date; end: Date };
  totalSpent: number;
  byAgent: Record<IDEType, { calls: number; tokens: number; cost: number }>;
  byRitual: Record<string, { tasks: number; cost: number }>;
  topExpensiveTasks: Array<{ taskId: string; cost: number; agentType: IDEType }>;
}

export interface BillingConfig {
  storagePath: string;
  autoSave: boolean;
  maxTransactionHistory: number;
}

// ============================================================================
// Credit System
// ============================================================================

export class CreditSystem {
  private account: CreditAccount;
  private config: BillingConfig;
  private saveTimer?: NodeJS.Timeout;

  constructor(account: CreditAccount, config?: Partial<BillingConfig>) {
    this.account = account;
    this.config = {
      storagePath: config?.storagePath || path.join(os.homedir(), '.summon', 'billing'),
      autoSave: config?.autoSave ?? true,
      maxTransactionHistory: config?.maxTransactionHistory || 100
    };

    this.ensureStorageDir();
  }

  // ========================================================================
  // Static Factory Methods
  // ========================================================================

  static async load(userId: string, config?: Partial<BillingConfig>): Promise<CreditSystem> {
    const storagePath = config?.storagePath || path.join(os.homedir(), '.summon', 'billing');
    const filePath = path.join(storagePath, `${userId}.json`);

    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const account: CreditAccount = {
        ...data,
        quota: data.quota ? {
          ...data.quota,
          resetsAt: new Date(data.quota.resetsAt)
        } : undefined,
        recentTransactions: data.recentTransactions.map((t: any) => ({
          ...t,
          timestamp: new Date(t.timestamp)
        })),
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt)
      };

      // Check for monthly quota reset
      if (account.quota && new Date() >= account.quota.resetsAt) {
        account.quota.usedThisMonth = 0;
        account.quota.resetsAt = CreditSystem.getNextResetDate();
        account.balance = account.quota.monthlyCredits;
      }

      return new CreditSystem(account, config);
    }

    // Create new account
    return CreditSystem.create(userId, 'free', config);
  }

  static async create(
    userId: string,
    tier: UserTier,
    config?: Partial<BillingConfig>
  ): Promise<CreditSystem> {
    const tierConfig = TIER_CONFIGS[tier];
    
    const account: CreditAccount = {
      userId,
      tier,
      balance: tier === 'free' ? tierConfig.monthlyCredits! : 0,
      totalSpent: 0,
      quota: tier === 'free' ? {
        monthlyCredits: tierConfig.monthlyCredits!,
        usedThisMonth: 0,
        resetsAt: CreditSystem.getNextResetDate()
      } : undefined,
      recentTransactions: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const system = new CreditSystem(account, config);
    await system.save();
    return system;
  }

  private static getNextResetDate(): Date {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth;
  }

  // ========================================================================
  // Credit Operations
  // ========================================================================

  /**
   * Check if user has sufficient credits for estimated cost
   */
  async checkBalance(estimatedCost: number): Promise<{ sufficient: boolean; balance: number }> {
    // For paid tier, always allow (post-pay)
    if (this.account.tier === 'paid') {
      return { sufficient: true, balance: this.account.balance };
    }

    // For free tier, enforce hard limit
    return {
      sufficient: this.account.balance >= estimatedCost,
      balance: this.account.balance
    };
  }

  /**
   * Pre-authorize estimated cost (for free tier)
   */
  async preauthorize(estimatedCost: number): Promise<{ authorized: boolean; holdAmount: number }> {
    if (this.account.tier === 'free') {
      const check = await this.checkBalance(estimatedCost);
      if (!check.sufficient) {
        return { authorized: false, holdAmount: 0 };
      }
      // Reserve the estimated amount
      return { authorized: true, holdAmount: estimatedCost };
    }

    // Paid tier: no pre-auth needed
    return { authorized: true, holdAmount: 0 };
  }

  /**
   * Deduct actual cost after task completion
   */
  async deduct(
    amount: number,
    details: {
      ritualId?: string;
      taskId?: string;
      agentType?: IDEType;
      description: string;
    }
  ): Promise<{ deducted: number; remaining: number }> {
    this.account.balance -= amount;
    this.account.totalSpent += amount;

    if (this.account.quota) {
      this.account.quota.usedThisMonth += amount;
    }

    const transaction: CreditTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'debit',
      amount: -amount,
      balanceAfter: this.account.balance,
      description: details.description,
      ritualId: details.ritualId,
      taskId: details.taskId,
      agentType: details.agentType,
      timestamp: new Date()
    };

    this.addTransaction(transaction);
    this.account.updatedAt = new Date();

    if (this.config.autoSave) {
      await this.save();
    }

    return {
      deducted: amount,
      remaining: this.account.balance
    };
  }

  /**
   * Add credits (top-up for paid tier)
   */
  async addCredits(amount: number, source: string): Promise<number> {
    this.account.balance += amount;

    const transaction: CreditTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'credit',
      amount,
      balanceAfter: this.account.balance,
      description: `Credit top-up: ${source}`,
      timestamp: new Date()
    };

    this.addTransaction(transaction);
    this.account.updatedAt = new Date();

    if (this.config.autoSave) {
      await this.save();
    }

    return this.account.balance;
  }

  /**
   * Refund credits (for failed tasks)
   */
  async refund(
    amount: number,
    details: {
      ritualId?: string;
      taskId?: string;
      reason: string;
    }
  ): Promise<number> {
    this.account.balance += amount;

    const transaction: CreditTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'refund',
      amount,
      balanceAfter: this.account.balance,
      description: `Refund: ${details.reason}`,
      ritualId: details.ritualId,
      taskId: details.taskId,
      timestamp: new Date()
    };

    this.addTransaction(transaction);
    this.account.updatedAt = new Date();

    if (this.config.autoSave) {
      await this.save();
    }

    return this.account.balance;
  }

  // ========================================================================
  // Tier Management
  // ========================================================================

  async upgradeTier(newTier: UserTier): Promise<void> {
    const oldTier = this.account.tier;
    
    if (oldTier === newTier) return;

    this.account.tier = newTier;

    if (newTier === 'free') {
      // Downgrade: set up quota
      this.account.quota = {
        monthlyCredits: TIER_CONFIGS.free.monthlyCredits!,
        usedThisMonth: 0,
        resetsAt: CreditSystem.getNextResetDate()
      };
      this.account.balance = this.account.quota.monthlyCredits;
    } else {
      // Upgrade: remove quota, keep balance or start at 0
      this.account.quota = undefined;
      // Optionally: add welcome credits
    }

    const transaction: CreditTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'credit',
      amount: 0,
      balanceAfter: this.account.balance,
      description: `Tier change: ${oldTier} → ${newTier}`,
      timestamp: new Date()
    };

    this.addTransaction(transaction);
    this.account.updatedAt = new Date();

    if (this.config.autoSave) {
      await this.save();
    }
  }

  getTier(): UserTier {
    return this.account.tier;
  }

  // ========================================================================
  // Queries
  // ========================================================================

  getBalance(): number {
    return this.account.balance;
  }

  getQuotaInfo(): { monthly: number; used: number; remaining: number; resetsAt: Date } | null {
    if (!this.account.quota) return null;

    return {
      monthly: this.account.quota.monthlyCredits,
      used: this.account.quota.usedThisMonth,
      remaining: this.account.quota.monthlyCredits - this.account.quota.usedThisMonth,
      resetsAt: this.account.quota.resetsAt
    };
  }

  getTransactions(limit = 20): CreditTransaction[] {
    return this.account.recentTransactions.slice(0, limit);
  }

  async generateUsageReport(days = 30): Promise<UsageReport> {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    const transactions = this.account.recentTransactions.filter(
      t => t.timestamp >= start && t.timestamp <= end && t.type === 'debit'
    );

    const byAgent: UsageReport['byAgent'] = {
      claude: { calls: 0, tokens: 0, cost: 0 },
      codex: { calls: 0, tokens: 0, cost: 0 },
      kimi: { calls: 0, tokens: 0, cost: 0 },
      opencode: { calls: 0, tokens: 0, cost: 0 }
    };

    const byRitual: Record<string, { tasks: number; cost: number }> = {};
    const taskCosts: Array<{ taskId: string; cost: number; agentType: IDEType }> = [];

    for (const tx of transactions) {
      if (tx.agentType) {
        byAgent[tx.agentType].calls++;
        byAgent[tx.agentType].cost += Math.abs(tx.amount);
      }

      if (tx.ritualId) {
        if (!byRitual[tx.ritualId]) {
          byRitual[tx.ritualId] = { tasks: 0, cost: 0 };
        }
        byRitual[tx.ritualId].tasks++;
        byRitual[tx.ritualId].cost += Math.abs(tx.amount);
      }

      if (tx.taskId && tx.agentType) {
        taskCosts.push({
          taskId: tx.taskId,
          cost: Math.abs(tx.amount),
          agentType: tx.agentType
        });
      }
    }

    // Sort by cost descending
    taskCosts.sort((a, b) => b.cost - a.cost);

    return {
      period: { start, end },
      totalSpent: transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0),
      byAgent,
      byRitual,
      topExpensiveTasks: taskCosts.slice(0, 10)
    };
  }

  // ========================================================================
  // Cost Calculation
  // ========================================================================

  calculateEstimatedCost(agentType: IDEType, estimatedTokens: number): number {
    const rates = AGENT_COSTS[agentType];
    const tokenCost = (estimatedTokens / 1000) * rates.per1KTokens;
    return tokenCost + rates.perSpawn;
  }

  calculateActualCost(agentType: IDEType, tokensUsed: number): number {
    const rates = AGENT_COSTS[agentType];
    const tokenCost = (tokensUsed / 1000) * rates.per1KTokens;
    return tokenCost + rates.perSpawn;
  }

  // ========================================================================
  // Storage
  // ========================================================================

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.config.storagePath)) {
      fs.mkdirSync(this.config.storagePath, { recursive: true });
    }
  }

  async save(): Promise<void> {
    this.ensureStorageDir();
    const filePath = path.join(this.config.storagePath, `${this.account.userId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(this.account, null, 2));
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private addTransaction(tx: CreditTransaction): void {
    this.account.recentTransactions.unshift(tx);
    if (this.account.recentTransactions.length > this.config.maxTransactionHistory) {
      this.account.recentTransactions = this.account.recentTransactions.slice(0, this.config.maxTransactionHistory);
    }
  }
}

// ============================================================================
// Global Instance
// ============================================================================

let globalCreditSystem: CreditSystem | null = null;

export async function getCreditSystem(userId?: string): Promise<CreditSystem> {
  if (!globalCreditSystem) {
    const id = userId || 'default';
    globalCreditSystem = await CreditSystem.load(id);
  }
  return globalCreditSystem;
}

export function setCreditSystem(system: CreditSystem): void {
  globalCreditSystem = system;
}
