// Observability — Barrel Export
export { MetricsCollector, getMetricsCollector } from './collector.js';
export { Dashboard } from './dashboard.js';
export type {
  RitualMetrics,
  TaskMetrics,
  RoutingDecision,
  CheckpointEvent,
  RoutingAccuracyReport,
  DailySummary,
} from './collector.js';
export type { WeeklyReport } from './dashboard.js';
