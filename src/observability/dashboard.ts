// Observability Dashboard — Real-time & Historical Views

import { MetricsCollector, RitualMetrics, TaskMetrics, DailySummary } from './collector.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Dashboard Types
// ============================================================================

export interface DashboardConfig {
  title: string;
  refreshIntervalMs?: number;
  sections: DashboardSection[];
}

export interface DashboardSection {
  title: string;
  type: 'summary' | 'chart' | 'table' | 'alert';
  metrics: string[];
}

export interface RealtimeView {
  activeRituals: number;
  completedToday: number;
  tokensThisHour: number;
  costToday: number;
  currentRoutingAccuracy: number;
  recentErrors: string[];
}

// ============================================================================
// Dashboard Renderer
// ============================================================================

export class Dashboard {
  private collector: MetricsCollector;
  private outputDir: string;
  
  constructor(collector: MetricsCollector, outputDir: string) {
    this.collector = collector;
    this.outputDir = outputDir;
  }
  
  // ========================================================================
  // Real-time Views
  // ========================================================================
  
  renderRealtime(): string {
    const today = new Date().toISOString().slice(0, 10);
    const summary = this.collector.getDailySummary(today);
    
    const lines: string[] = [];
    
    lines.push('╔══════════════════════════════════════════════════════════╗');
    lines.push('║         🔥 SUMMON RITUAL OBSERVABILITY                   ║');
    lines.push('╠══════════════════════════════════════════════════════════╣');
    lines.push(`║  Date: ${today.padEnd(47)} ║`);
    lines.push('╠══════════════════════════════════════════════════════════╣');
    lines.push('║  TODAY\'S ACTIVITY                                        ║');
    lines.push(`║    Rituals: ${String(summary.completedRituals).padStart(3)} completed │ ${String(summary.failedRituals).padStart(3)} failed         ║`);
    lines.push(`║    Tasks:   ${String(summary.totalTasks).padStart(3)} total                              ║`);
    lines.push(`║    Tokens:  ${this.formatNumber(summary.totalTokens).padStart(15)}                       ║`);
    lines.push(`║    Cost:    $${summary.totalCost.toFixed(4).padStart(10)}                           ║`);
    lines.push('╠══════════════════════════════════════════════════════════╣');
    lines.push('║  ROUTING ACCURACY                                        ║');
    lines.push(`║    Rate:    ${(summary.routingAccuracy.accuracyRate * 100).toFixed(1)}%${''.padStart(39)} ║`);
    lines.push(`║    Wasted:  $${summary.routingAccuracy.wastedCost.toFixed(4)} / day                    ║`);
    if (summary.routingAccuracy.recommendations.length > 0) {
      lines.push('║  Recommendations:                                        ║');
      summary.routingAccuracy.recommendations.slice(0, 2).forEach(rec => {
        const truncated = rec.slice(0, 52);
        lines.push(`║    • ${truncated.padEnd(52)} ║`);
      });
    }
    lines.push('╚══════════════════════════════════════════════════════════╝');
    
    return lines.join('\n');
  }
  
  renderRitualDetail(ritualId: string): string {
    const metrics = this.collector.getRitualReport(ritualId);
    if (!metrics) return `Ritual not found: ${ritualId}`;
    
    const lines: string[] = [];
    
    lines.push(`\n🔥 Ritual: ${ritualId.slice(0, 20)}...`);
    lines.push(`   Goal: ${metrics.goal.slice(0, 60)}`);
    lines.push(`   State: ${metrics.state} │ Duration: ${this.formatDuration(metrics.durationMs)}`);
    lines.push('');
    lines.push('   Task Breakdown:');
    lines.push(`     Total: ${metrics.totalTasks} │ Completed: ${metrics.completedTasks} │ Failed: ${metrics.failedTasks}`);
    lines.push('');
    lines.push('   Cost Analysis:');
    lines.push(`     Total: $${metrics.estimatedCost.toFixed(4)} │ Per Task: $${metrics.costPerTask.toFixed(4)}`);
    lines.push(`     Tokens: ${this.formatNumber(metrics.totalTokens)}`);
    lines.push('');
    lines.push('   Agent Usage:');
    Object.entries(metrics.agentCalls).forEach(([agent, count]) => {
      if (count > 0) {
        const cost = metrics.costByAgent[agent as keyof typeof metrics.costByAgent] || 0;
        lines.push(`     ${agent.padStart(8)}: ${String(count).padStart(3)} calls │ $${cost.toFixed(4)} │ ${metrics.tokensByAgent[agent as keyof typeof metrics.tokensByAgent] || 0} tokens`);
      }
    });
    lines.push('');
    lines.push('   Performance:');
    lines.push(`     Avg Task: ${this.formatDuration(metrics.avgTaskDurationMs)}`);
    lines.push(`     Min/Max:  ${this.formatDuration(metrics.minTaskDurationMs)} / ${this.formatDuration(metrics.maxTaskDurationMs)}`);
    if (metrics.checkpointsCreated > 0) {
      lines.push(`     Checkpoints: ${metrics.checkpointsCreated} │ Recoveries: ${metrics.recoveryCount}`);
    }
    
    return lines.join('\n');
  }
  
  // ========================================================================
  // Historical Reports
  // ========================================================================
  
  generateWeeklyReport(): WeeklyReport {
    const reports: DailySummary[] = [];
    
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      
      try {
        const summary = this.collector.getDailySummary(dateStr);
        reports.push(summary);
      } catch {
        // No data for this day
      }
    }
    
    const totalCost = reports.reduce((sum, r) => sum + r.totalCost, 0);
    const totalTokens = reports.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalRituals = reports.reduce((sum, r) => sum + r.totalRituals, 0);
    
    // Cost trend
    const costs = reports.map(r => r.totalCost).reverse();
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (costs.length > 1) {
      const first = costs[0];
      const last = costs[costs.length - 1];
      if (last < first) {
        trend = 'decreasing';
      } else if (last > first) {
        trend = 'increasing';
      }
    }
    
    return {
      days: reports.length,
      totalRituals,
      totalCost,
      totalTokens,
      avgDailyCost: totalCost / Math.max(reports.length, 1),
      costTrend: trend,
      topExpensiveRituals: [], // Would need to aggregate
      recommendations: this.generateWeeklyRecommendations(reports)
    };
  }
  
  private generateWeeklyRecommendations(reports: DailySummary[]): string[] {
    const recs: string[] = [];
    
    const avgRoutingAccuracy = reports.reduce((sum, r) => sum + r.routingAccuracy.accuracyRate, 0) / reports.length;
    if (avgRoutingAccuracy < 0.8) {
      recs.push('Routing accuracy below 80% — review routing rules');
    }
    
    const totalWasted = reports.reduce((sum, r) => sum + r.routingAccuracy.wastedCost, 0);
    if (totalWasted > 1.0) {
      recs.push(`Potential savings: $${totalWasted.toFixed(2)}/week from better routing`);
    }
    
    const failureRate = reports.reduce((sum, r) => sum + r.failedRituals, 0) / 
      Math.max(reports.reduce((sum, r) => sum + r.totalRituals, 0), 1);
    if (failureRate > 0.1) {
      recs.push(`Failure rate ${(failureRate * 100).toFixed(1)}% — consider adding retry logic`);
    }
    
    return recs;
  }
  
  // ========================================================================
  // Export
  // ========================================================================
  
  exportToHtml(): string {
    const today = new Date().toISOString().slice(0, 10);
    const summary = this.collector.getDailySummary(today);
    const weekly = this.generateWeeklyReport();
    
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Summon Observability</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    .card { background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 10px 0; }
    .metric { display: inline-block; margin: 10px 20px; }
    .metric-value { font-size: 2em; font-weight: bold; color: #333; }
    .metric-label { color: #666; font-size: 0.9em; }
    .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin: 10px 0; }
    .success { background: #d4edda; border-left: 4px solid #28a745; }
  </style>
</head>
<body>
  <h1>🔥 Summon Observability Dashboard</h1>
  
  <div class="card">
    <h2>Today's Activity (${today})</h2>
    <div class="metric">
      <div class="metric-value">${summary.completedRituals}</div>
      <div class="metric-label">Rituals Completed</div>
    </div>
    <div class="metric">
      <div class="metric-value">${this.formatNumber(summary.totalTokens)}</div>
      <div class="metric-label">Tokens</div>
    </div>
    <div class="metric">
      <div class="metric-value">$${summary.totalCost.toFixed(2)}</div>
      <div class="metric-label">Cost</div>
    </div>
  </div>
  
  <div class="card">
    <h2>7-Day Summary</h2>
    <p>Total Cost: <strong>$${weekly.totalCost.toFixed(2)}</strong> 
       (avg $${weekly.avgDailyCost.toFixed(2)}/day)</p>
    <p>Trend: <strong>${weekly.costTrend}</strong></p>
  </div>
  
  ${weekly.recommendations.map(r => `
    <div class="alert">💡 ${r}</div>
  `).join('')}
  </body>
</html>`;
  }
  
  saveHtml(outputPath?: string): string {
    const html = this.exportToHtml();
    const filePath = outputPath || path.join(this.outputDir, 'dashboard.html');
    fs.writeFileSync(filePath, html);
    return filePath;
  }
  
  // ========================================================================
  // Utilities
  // ========================================================================
  
  private formatNumber(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
  
  private formatDuration(ms: number): string {
    if (ms === Infinity || ms === 0) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface WeeklyReport {
  days: number;
  totalRituals: number;
  totalCost: number;
  totalTokens: number;
  avgDailyCost: number;
  costTrend: 'increasing' | 'decreasing' | 'stable';
  topExpensiveRituals: { ritualId: string; cost: number }[];
  recommendations: string[];
}
