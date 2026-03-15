# Ritual Graduation Criteria v1.0

## Purpose
Define objective standards for promoting a ritual from **draft** → **graduated** → **published**.

Without clear criteria, the registry fills with untested, low-quality rituals.

---

## Graduation Tiers

```
Draft → Graduated → Published
        (tested)    (public)
```

### 1. Draft → Graduated

**Minimum Requirements (ALL must pass):**

| # | Criteria | Threshold | Measurement |
|---|----------|-----------|-------------|
| 1 | **Executions** | ≥ 10 successful runs | Trace logs |
| 2 | **Success Rate** | ≥ 80% | (success / total) from traces |
| 3 | **Avg Latency** | ≤ 30s (p95) | Trace durationMs |
| 4 | **Cost** | ≤ $0.10/run avg | Token usage × model pricing |
| 5 | **No Fatal Errors** | 0 unhandled exceptions | Error tracking |
| 6 | **Schema Valid** | Passes ritual.yaml validation | JSON Schema |
| 7 | **Documentation** | Description + examples | YAML fields |
| 8 | **Tool Binding** | All tools resolve | Runtime check |

**Graduation Review Process:**

```typescript
interface GraduationReview {
  ritualId: string;
  reviewer: 'automated' | 'human' | 'claude' | 'kimi';
  
  // Automated checks (must all pass)
  automatedResults: {
    executions: { passed: boolean; count: number; };
    successRate: { passed: boolean; rate: number; };
    latency: { passed: boolean; p95: number; };
    cost: { passed: boolean; avgUsd: number; };
    errors: { passed: boolean; count: number; };
    schema: { passed: boolean; errors: string[]; };
  };
  
  // Qualitative review (for human/AI reviewers)
  qualitativeScore?: {
    usefulness: 1-5;      // Does it solve a real problem?
    robustness: 1-5;      // Handles edge cases?
    clarity: 1-5;         // Easy to understand/use?
    efficiency: 1-5;      // Cost-effective for task?
  };
  
  // Final verdict
  passed: boolean;
  blockers: string[];     // If failed, why
  recommendations: string[]; // If passed, improvements
  
  reviewedAt: ISO8601;
}
```

**Review Triggers:**
- User requests graduation via TUI: `[g] Graduate Draft`
- Automated when criteria met (if auto-graduate enabled)
- Refiner suggests graduation after analysis

### 2. Graduated → Published

**Additional Requirements:**

| # | Criteria | Notes |
|---|----------|-------|
| 1 | **Checksum** | SHA256 of canonical YAML computed |
| 2 | **Author Verified** | DID resolved to known identity |
| 3 | **No Duplicates** | Not functionally identical to existing ritual |
| 4 | **License** | Has valid SPDX license identifier |
| 5 | **Tags Valid** | At least 1 tag from approved taxonomy |

**Publication Actions:**
- YAML uploaded to R2
- Metadata written to D1
- Search index updated (FTS5)
- CDN cache invalidated

---

## Reviewer Roles

### Automated Reviewer
- Runs all objective checks
- Fast (< 1 second)
- Always runs first

### AI Reviewer (Claude/Kimi)
- Reviews qualitative aspects
- Suggests improvements
- Sample prompt:

```
Review this ritual for graduation:

Name: {name}
Description: {description}
Executions: {executionCount}
Sample traces: {traceLogs}

Rate on:
1. Usefulness (1-5): Does it solve a clear problem?
2. Robustness (1-5): Will it handle varied inputs?
3. Clarity (1-5): Is the purpose clear?
4. Efficiency (1-5): Is the cost justified?

Provide specific improvement suggestions.
```

### Human Reviewer (River or community)
- Final approval for borderline cases
- Arbitration on disputes
- Sets precedent for edge cases

---

## Re-graduation (Version Updates)

When a ritual has a new version:

```
v1.0.0 (graduated) → v1.1.0 (draft) → v1.1.0 (graduated)
                              ↓
                     Must re-qualify with same criteria
                     But: can skip if changes are cosmetic
```

**Fast-track re-graduation:**
- Only prompt changed → Automated review
- Tool bindings changed → Full re-review
- New required secrets → Full re-review

---

## Registry Quality Tiers

| Tier | Badge | Criteria |
|------|-------|----------|
| **Draft** | 📝 | In development |
| **Graduated** | ✅ | Passed automated tests |
| **Verified** | ✓ | AI reviewed |
| **Published** | 🌐 | Public in registry |
| **Trending** | 🔥 | Top 10% by downloads |
| **Certified** | 🏆 | Human reviewed + endorsed |

---

## Enforcement

**In TUI:**
- Draft rituals show warning: "Not graduated - may be unstable"
- Graduation status shown in ritual browser
- Option to filter by quality tier

**In Registry API:**
- `GET /api/v1/rituals?quality=graduated` filters drafts
- Default search excludes drafts unless `?includeDrafts=true`

---

## Future: Community Graduation

When community contributions open:

1. **Propose:** Anyone can submit draft
2. **Test:** Community members run it, provide traces
3. **Graduate:** Automated + AI review
4. **Challenge:** If reported broken, reverts to draft

**Reputation system:**
- Authors with 3+ graduated rituals get "Trusted" badge
- Trusted authors can auto-graduate (skips AI review)

---

## Spec Status

- **Version:** 1.0
- **Status:** Draft (ironic)
- **Next Review:** After first 5 rituals graduate
