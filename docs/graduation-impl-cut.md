# Graduation - Cut Down MVP

## Two States Only

```
Draft → Published
```

## 5 Checks (Automated Only)

| # | Check | Command |
|---|-------|---------|
| 1 | ≥ 5 successful runs | `summon stats` |
| 2 | ≥ 70% success rate | `summon stats` |
| 3 | Valid ritual.yaml | `zod` schema |
| 4 | All tools resolve | Runtime check |
| 5 | Has description | YAML field |

## Implementation (src/graduation/index.ts)

```typescript
import { getRitualStats } from '../telemetry/stats';
import { loadRitual } from '../ritual/loader';
import { resolveTool } from '../tools/registry';

export interface GraduationResult {
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    value?: string | number;
    reason?: string;
  }[];
}

export function checkGraduation(ritualId: string): GraduationResult {
  const checks = [];
  
  // 1. Load ritual
  const ritual = loadRitual(ritualId);
  if (!ritual) {
    return { passed: false, checks: [{ name: 'ritual_exists', passed: false, reason: 'Ritual not found' }] };
  }
  
  // 2. Get stats
  const stats = getRitualStats(ritualId);
  
  // Check 1: Executions
  checks.push({
    name: 'executions',
    passed: stats.executions >= 5,
    value: stats.executions,
    reason: stats.executions < 5 ? `Need 5 runs, have ${stats.executions}` : undefined
  });
  
  // Check 2: Success rate
  const successRate = Math.round(stats.successRate * 100);
  checks.push({
    name: 'success_rate',
    passed: stats.successRate >= 0.70,
    value: `${successRate}%`,
    reason: stats.successRate < 0.70 ? `Need 70%, have ${successRate}%` : undefined
  });
  
  // Check 3: Valid YAML (already loaded)
  checks.push({
    name: 'valid_yaml',
    passed: true,
    value: 'valid'
  });
  
  // Check 4: Tools resolve
  const toolChecks = (ritual.skills || []).map(skill => {
    return skill.requiredTools?.every(tool => {
      try {
        resolveTool(tool);
        return true;
      } catch {
        return false;
      }
    }) ?? true;
  });
  const allToolsResolve = toolChecks.every(Boolean);
  checks.push({
    name: 'tools_resolve',
    passed: allToolsResolve,
    reason: allToolsResolve ? undefined : 'Some required tools not found'
  });
  
  // Check 5: Description
  const hasDescription = !!ritual.description && ritual.description.length > 10;
  checks.push({
    name: 'description',
    passed: hasDescription,
    reason: hasDescription ? undefined : 'Need description > 10 chars'
  });
  
  return {
    passed: checks.every(c => c.passed),
    checks
  };
}
```

## CLI Command

```bash
summon check @river/stock-checker
# ✓ executions: 7/5
# ✓ success_rate: 85%/70%
# ✓ valid_yaml
# ✓ tools_resolve
# ✓ description
# 
# ✅ Ready to publish

summon publish @river/stock-checker
# Runs check → if pass → uploads to registry
```

## Registry Update

When published:
- Ritual marked `status: 'published'`
- Upload to R2
- Update D1

## No AI Reviewer

No qualitative scoring. No "usefulness" or "robustness" ratings. Automated checks only.

## No Graduation Tier

"Graduated" = "Published". One state change.
