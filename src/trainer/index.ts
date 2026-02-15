/**
 * Summon Agent Trainer
 * 
 * Async decision-point messaging for agent training sessions.
 * Humans can review and chat at specific points without real-time presence.
 * 
 * @example
 * ```typescript
 * import { createDecisionPoint, appendChatMessage } from './trainer';
 * 
 * // Create a decision point when pattern detected
 * const point = createDecisionPoint(sessionId, roundNumber, {
 *   type: 'gap',
 *   trigger: { name: 'retry-loop', severity: 'warning', ... },
 *   robotMessage: { content: 'I noticed...', suggestedActions: [...] },
 *   context: { sessionId, roundNumber, agentName },
 * });
 * 
 * // Human responds later
 * appendChatMessage(point.id, { sender: 'human', content: 'Try approach B' });
 * ```
 */

export * from './types';
export * from './store';
export * from './detector';
export { registerTrainerCommands } from './cli';
