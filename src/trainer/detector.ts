/**
 * Pattern Detector
 * 
 * Detects patterns in agent training sessions that warrant human decision.
 * Creates DecisionPoints automatically when patterns are found.
 */

import type { DetectionResult, DecisionType, SuggestedAction, DecisionContext } from './types';

// Session round data for analysis
interface Round {
  number: number;
  agent: string;
  status: 'pass' | 'fail' | 'waiting';
  duration: number;
  tokensIn: number;
  tokensOut: number;
  turns: number;
  output: string;
  artifacts?: string[];
}

interface Session {
  id: string;
  rounds: Round[];
  config: {
    maxRetries: number;
    targetQuality?: number;
  };
}

/**
 * Detect retry loops - same step failing repeatedly
 */
export function detectRetryLoop(session: Session): DetectionResult {
  const recentRounds = session.rounds.slice(-3);
  
  if (recentRounds.length < 2) return { detected: false };
  
  const allFailed = recentRounds.every(r => r.status === 'fail');
  const sameAgent = recentRounds.every(r => r.agent === recentRounds[0].agent);
  
  if (allFailed && sameAgent) {
    const retryCount = recentRounds.length;
    const maxRetries = session.config.maxRetries || 3;
    
    const actions: SuggestedAction[] = [
      {
        id: 'switch-agent',
        label: 'Switch Agent',
        description: `Try ${recentRounds[0].agent === 'codex' ? 'claude' : 'codex'} instead`,
      },
      {
        id: 'reduce-scope',
        label: 'Reduce Scope',
        description: 'Break task into smaller pieces',
      },
      {
        id: 'manual-fix',
        label: 'Manual Fix',
        description: 'I will fix it myself',
      },
      {
        id: 'continue-retry',
        label: 'Continue Retrying',
        description: `Allow up to ${maxRetries} retries`,
      },
    ];
    
    return {
      detected: true,
      type: 'failure',
      trigger: {
        name: 'retry-loop',
        description: `${retryCount} consecutive failures with ${recentRounds[0].agent}`,
        severity: retryCount >= maxRetries ? 'critical' : 'warning',
      },
      message: `I've failed ${retryCount} times in a row with ${recentRounds[0].agent}. ` +
        `Latest error: "${recentRounds[recentRounds.length - 1].output.slice(0, 100)}..." ` +
        `Should I switch agents, reduce scope, or keep trying?`,
      suggestedActions: actions,
    };
  }
  
  return { detected: false };
}

/**
 * Detect quality decline - output getting worse over time
 */
export function detectQualityDecline(current: Round, previous: Round): DetectionResult {
  // Heuristic: if tokens drop significantly or duration changes abruptly
  const tokenRatio = current.tokensOut / (previous.tokensOut || 1);
  const durationRatio = current.duration / (previous.duration || 1);
  
  // Significant quality drop: output much shorter or much longer (blowing up)
  const qualityDrop = tokenRatio < 0.3 || tokenRatio > 3;
  const timeSpike = durationRatio > 2;
  
  if (qualityDrop || timeSpike) {
    const issues: string[] = [];
    if (tokenRatio < 0.3) issues.push('output suspiciously short');
    if (tokenRatio > 3) issues.push('output unexpectedly long');
    if (timeSpike) issues.push(`took ${Math.round(durationRatio)}x longer`);
    
    return {
      detected: true,
      type: 'gap',
      trigger: {
        name: 'quality-decline',
        description: `Quality shift detected: ${issues.join(', ')}`,
        severity: 'warning',
      },
      message: `Round ${current.number} shows ${issues.join(', ')} compared to Round ${previous.number}. ` +
        `Previous: ${previous.tokensOut} tokens in ${previous.duration}s. ` +
        `Current: ${current.tokensOut} tokens in ${current.duration}s. ` +
        `Is this expected or should I investigate?`,
      suggestedActions: [
        { id: 'investigate', label: 'Investigate', description: 'Show me the full diff' },
        { id: 'accept', label: 'Accept', description: 'This is expected' },
        { id: 'revert', label: 'Revert', description: 'Go back to previous round' },
      ],
    };
  }
  
  return { detected: false };
}

/**
 * Detect drop-off - step didn't address previous findings
 */
export function detectDropOff(current: Round, previous: Round): DetectionResult {
  // Heuristic: if previous found issues but current didn't address them
  const previousFoundIssues = previous.output.toLowerCase().includes('issue') ||
    previous.output.toLowerCase().includes('error') ||
    previous.output.toLowerCase().includes('problem');
  
  const currentAddressed = current.output.toLowerCase().includes('fix') ||
    current.output.toLowerCase().includes('resolved') ||
    current.output.toLowerCase().includes('addressed');
  
  if (previousFoundIssues && !currentAddressed) {
    return {
      detected: true,
      type: 'gap',
      trigger: {
        name: 'drop-off',
        description: 'Previous issues not addressed',
        severity: 'warning',
      },
      message: `Round ${previous.number} found issues, but Round ${current.number} doesn't seem to address them. ` +
        `Previous mentioned: "${previous.output.slice(0, 80)}..." ` +
        `Current is about: "${current.output.slice(0, 80)}..." ` +
        `Should the current round include these fixes?`,
      suggestedActions: [
        { id: 'expand-scope', label: 'Expand Scope', description: 'Add fixes to current round' },
        { id: 'keep-separate', label: 'Keep Separate', description: 'Handle in follow-up round' },
        { id: 'skip-issues', label: 'Skip Issues', description: 'Issues are out of scope' },
      ],
    };
  }
  
  return { detected: false };
}

/**
 * Detect when a decision fork is needed
 */
export function detectForkNeeded(context: {
  currentRound: number;
  description: string;
  options: string[];
}): DetectionResult {
  if (context.options.length >= 2) {
    return {
      detected: true,
      type: 'fork',
      trigger: {
        name: 'decision-fork',
        description: `Multiple paths available: ${context.options.join(' vs ')}`,
        severity: 'info',
      },
      message: `At step ${context.currentRound}, I see multiple valid approaches:\n` +
        context.options.map((o, i) => `${i + 1}. ${o}`).join('\n') +
        '\n\nWhich direction should I take?',
      suggestedActions: context.options.map((opt, i) => ({
        id: `fork-${i}`,
        label: opt,
        command: `summon trainer fork --session ${context.description} --choice ${i}`,
      })),
    };
  }
  
  return { detected: false };
}

/**
 * Detect milestone completion worth reviewing
 */
export function detectMilestone(session: Session, milestones: string[]): DetectionResult {
  const completedRound = session.rounds[session.rounds.length - 1];
  
  // Check if we just hit a milestone
  const milestoneIndex = milestones.findIndex(m => 
    completedRound.output.toLowerCase().includes(m.toLowerCase()) ||
    completedRound.artifacts?.some(a => a.toLowerCase().includes(m.toLowerCase()))
  );
  
  if (milestoneIndex >= 0) {
    return {
      detected: true,
      type: 'milestone',
      trigger: {
        name: 'milestone-reached',
        description: `Completed: ${milestones[milestoneIndex]}`,
        severity: 'info',
      },
      message: `🎯 Milestone reached: ${milestones[milestoneIndex]}\n\n` +
        `Round ${completedRound.number} completed successfully. ` +
        `Artifacts: ${completedRound.artifacts?.join(', ') || 'none'}\n\n` +
        `Ready to proceed or want to review?`,
      suggestedActions: [
        { id: 'continue', label: 'Continue', description: 'Proceed to next round' },
        { id: 'review', label: 'Review', description: 'Review artifacts first' },
        { id: 'pause', label: 'Pause', description: 'Wait for human input' },
      ],
    };
  }
  
  return { detected: false };
}

/**
 * Detect token spike - sudden increase in token usage
 */
export function detectTokenSpike(current: Round, previous: Round, threshold = 2): DetectionResult {
  const inRatio = current.tokensIn / (previous.tokensIn || 1);
  const outRatio = current.tokensOut / (previous.tokensOut || 1);
  
  if (inRatio > threshold || outRatio > threshold) {
    const spike = inRatio > outRatio ? 'input' : 'output';
    const ratio = Math.max(inRatio, outRatio);
    
    return {
      detected: true,
      type: 'gap',
      trigger: {
        name: 'token-spike',
        description: `${spike} tokens ${ratio.toFixed(1)}x higher than previous`,
        severity: 'warning',
      },
      message: `Token usage spike detected!\n` +
        `Previous: ${previous.tokensIn} in / ${previous.tokensOut} out\n` +
        `Current: ${current.tokensIn} in / ${current.tokensOut} out\n` +
        `That's ${ratio.toFixed(1)}x more ${spike} tokens. Should I optimize or is this expected?`,
      suggestedActions: [
        { id: 'optimize', label: 'Optimize', description: 'Try to reduce tokens' },
        { id: 'expected', label: 'Expected', description: 'This is necessary complexity' },
        { id: 'split', label: 'Split Task', description: 'Break into smaller chunks' },
      ],
    };
  }
  
  return { detected: false };
}

/**
 * Run all detectors on a session
 */
export function runAllDetectors(
  session: Session,
  context: Partial<DecisionContext> = {}
): DetectionResult[] {
  const results: DetectionResult[] = [];
  
  if (session.rounds.length === 0) return results;
  
  const current = session.rounds[session.rounds.length - 1];
  const previous = session.rounds.length > 1 
    ? session.rounds[session.rounds.length - 2] 
    : null;
  
  // Run session-level detectors
  const retryLoop = detectRetryLoop(session);
  if (retryLoop.detected) results.push(retryLoop);
  
  // Run round-comparison detectors
  if (previous) {
    const qualityDecline = detectQualityDecline(current, previous);
    if (qualityDecline.detected) results.push(qualityDecline);
    
    const dropOff = detectDropOff(current, previous);
    if (dropOff.detected) results.push(dropOff);
    
    const tokenSpike = detectTokenSpike(current, previous);
    if (tokenSpike.detected) results.push(tokenSpike);
  }
  
  return results;
}
