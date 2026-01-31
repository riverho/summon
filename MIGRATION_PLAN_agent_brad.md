# Migration Plan: agent_brad → summon Framework

**Created:** January 31, 2025  
**Source:** `/Users/river/clawd/projects/agent_brad`  
**Destination:** `/Users/river/clawd/projects/summon`

---

## Executive Summary

This document outlines the migration plan for moving agent_brad's skills, tools, and specialist agents to the summon framework. agent_brad is a comprehensive agent with financial data capabilities, web search, file operations, and specialized agents for different domains. The summon framework provides a modular skill and persona architecture.

**Key Findings:**
- **Already migrated:** Finance and web-search skills (basic implementations)
- **To migrate:** File operations (4 tools), advanced financial tools (8 tools), 2 specialist agents
- **Priority items:** File tools, crypto, news, insider trades (high-value features)
- **Estimated effort:** 2-3 weeks for complete migration

---

## 1. Current State: What's in agent_brad

### 1.1 Tool Categories

#### Finance Tools (10 tools)
Located in `src/tools/finance/`:

| Tool Name | Function | Description |
|-----------|----------|-------------|
| `get_price_snapshot` | Stock prices | Current price, OHLC, volume, market cap |
| `get_prices` | Stock prices | Historical price data with date ranges |
| `get_financial_metrics_snapshot` | Metrics | P/E ratio, EPS, dividend yield, market cap |
| `get_financial_metrics` | Metrics | Historical financial metrics |
| `get_income_statements` | Fundamentals | Revenue, expenses, net income |
| `get_balance_sheets` | Fundamentals | Assets, liabilities, equity |
| `get_cash_flow_statements` | Fundamentals | Operating, investing, financing cash flows |
| `get_all_financialStatements` | Fundamentals | All 3 statements in one call |
| `get_filings` | SEC filings | List of 10-K, 10-Q, 8-K filings |
| `get_10K_filing_items` | SEC filings | Extract specific 10-K sections (Item 1A, 7, etc.) |
| `get_10Q_filing_items` | SEC filings | Extract specific 10-Q sections |
| `get_8K_filing_items` | SEC filings | Extract specific 8-K sections |
| `get_news` | News | Recent news articles for a ticker |
| `get_analyst_estimates` | Estimates | EPS estimates, price targets |
| `get_insider_trades` | Insider trades | Form 4 filings, purchases/sales |
| `get_segmented_revenues` | Segments | Revenue breakdown by product/geography |
| `get_crypto_price_snapshot` | Crypto | Bitcoin, Ethereum, etc. current price |
| `get_crypto_prices` | Crypto | Historical crypto prices |
| `get_available_crypto_tickers` | Crypto | List of supported crypto pairs |
| `createFinancialSearch` | Unified search | Natural language financial queries |

#### Search Tools (2 tools)
Located in `src/tools/search/`:

| Tool Name | Function | Description |
|-----------|----------|-------------|
| `exaSearch` | Web search | Exa API for general web search |
| `tavilySearch` | Web search | Tavily API for general web search |

#### File Tools (4 tools)
Located in `src/tools/file/`:

| Tool Name | Function | Description |
|-----------|----------|-------------|
| `read_file` | Read file | Read file contents, returns metadata |
| `write_file` | Write file | Write content to file, with safety checks |
| `list_directory` | List directory | List directory contents with metadata |
| `create_directory` | Create directory | Create new directory with safety checks |

#### Utility Tools
- Pending action storage (`pending.ts`) - stores pending actions between sessions
- Configuration (`config.ts`) - path restrictions, default directories

### 1.2 Specialist Agents

Located in `src/agent/specialists/`:

| Agent | Capabilities | Use Case |
|-------|--------------|----------|
| `FinanceAgent` | All financial data, SEC filings, crypto, insider trades | Financial queries with ticker symbols |
| `ResearchAgent` | Industry analysis, competitor comparison, market trends | In-depth market research |
| `WebSearchAgent` | General web search, fact-checking | Current events, general knowledge |
| `FileAgent` | Simple file writes from instructions | Document creation |

---

## 2. Current State: What's Already in summon

### 2.1 Skills (Already Migrated)

#### Finance Skill
**Location:** `src/builtin/skills/finance/`
- **index.ts:** Implements `financial_search` tool using Alpha Vantage API
- **finance.yaml:** Skill definition with capabilities, trigger keywords, prompt fragment
- **Current coverage:**
  - `get_price_snapshot` ✓ (stub implementation)
  - `get_financial_metrics_snapshot` ✓ (stub implementation)
  - **Missing:** All other finance tools (filings, news, insider trades, crypto, segments, estimates)

#### Web Search Skill
**Location:** `src/builtin/skills/web-search/`
- **index.ts:** Implements `web_search` tool using Tavily or Exa API
- **web-search.yaml:** Skill definition with capabilities, trigger keywords, prompt fragment
- **Current coverage:** Complete ✓

#### Git Skill
**Location:** `src/builtin/skills/git/`
- Basic git operations already implemented

### 2.2 Personas (Already Migrated)

| Persona | File | Description |
|---------|------|-------------|
| `analyst` | `analyst.yaml` | Financial analyst, data-driven insights |
| `researcher` | `researcher.yaml` | Research assistant, information synthesis |

**Note:** These personas are basic. The specialist agents in agent_brad have more sophisticated behavior patterns.

---

## 3. Gap Analysis: What Needs Migration

### 3.1 Tools to Migrate (Priority Order)

#### HIGH Priority (Core Features)

**File Operations Skill** (4 tools)
| Tool | Complexity | Effort | Dependencies |
|------|------------|--------|--------------|
| `read_file` | Medium | 2-3 hours | None |
| `write_file` | Medium | 2-3 hours | None |
| `list_directory` | Low | 1-2 hours | None |
| `create_directory` | Low | 1-2 hours | None |

**Rationale:** File operations are fundamental and used frequently. Currently missing from summon.

**Finance Tools - Phase 1** (6 tools)
| Tool | Complexity | Effort | Dependencies |
|------|------------|--------|--------------|
| `get_crypto_price_snapshot` | Low | 2-3 hours | FINANCIAL_DATASETS_API_KEY |
| `get_crypto_prices` | Low | 2-3 hours | FINANCIAL_DATASETS_API_KEY |
| `get_crypto_tickers` | Low | 1 hour | FINANCIAL_DATASETS_API_KEY |
| `get_news` | Low | 2-3 hours | FINANCIAL_DATASETS_API_KEY |
| `get_insider_trades` | Medium | 3-4 hours | FINANCIAL_DATASETS_API_KEY |
| `get_analyst_estimates` | Medium | 3-4 hours | FINANCIAL_DATASETS_API_KEY |

**Rationale:** These are high-value features not available elsewhere. Easy to implement as additions to existing finance skill.

#### MEDIUM Priority (Advanced Financial)

**Finance Tools - Phase 2** (6 tools)
| Tool | Complexity | Effort | Dependencies |
|------|------------|--------|--------------|
| `get_filings` | Medium | 3-4 hours | FINANCIAL_DATASETS_API_KEY |
| `get_10K_filing_items` | Medium | 4-5 hours | FINANCIAL_DATASETS_API_KEY |
| `get_10Q_filing_items` | Medium | 4-5 hours | FINANCIAL_DATASETS_API_KEY |
| `get_8K_filing_items` | Medium | 4-5 hours | FINANCIAL_DATASETS_API_KEY |
| `get_income_statements` | Low | 2-3 hours | FINANCIAL_DATASETS_API_KEY |
| `get_balance_sheets` | Low | 2-3 hours | FINANCIAL_DATASETS_API_KEY |

**Rationale:** SEC filings and fundamentals provide deep financial analysis. Slightly more complex schema handling.

**Finance Tools - Phase 3** (3 tools)
| Tool | Complexity | Effort | Dependencies |
|------|------------|--------|--------------|
| `get_cash_flow_statements` | Low | 2-3 hours | FINANCIAL_DATASETS_API_KEY |
| `get_all_financial_statements` | Low | 2-3 hours | FINANCIAL_DATASETS_API_KEY |
| `get_segmented_revenues` | Medium | 3-4 hours | FINANCIAL_DATASETS_API_KEY |

**Rationale:** Cash flow and segmented revenues complete the financial picture.

#### LOW Priority (Enhancements)

**Enhanced Finance Skill**
| Item | Complexity | Effort | Dependencies |
|------|------------|--------|--------------|
| Extend `financial_search` to use Financial Datasets API | Medium | 4-6 hours | FINANCIAL_DATASETS_API_KEY |
| Add tool routing intelligence | Medium | 3-4 hours | None |
| Unified financial tool wrapper | Medium | 4-5 hours | None |

---

### 3.2 Personas to Migrate

#### MEDIUM Priority Personas

**File Agent Persona** (New)
| Aspect | Details |
|--------|---------|
| File | `src/builtin/personas/file-agent.yaml` |
| Role | File Operations Specialist |
| Goal | Simple file operations (writes from instructions) |
| Capabilities | Write documents, auto-naming, path safety |
| Complexity | Low |
| Effort | 2-3 hours |

**Web Search Agent Persona** (Enhancement)
| Aspect | Details |
|--------|---------|
| File | Enhance `researcher.yaml` or create `web-search-agent.yaml` |
| Role | Web Search Specialist |
| Goal | General web search and information retrieval |
| Capabilities | Tavily/Exa search, result synthesis |
| Complexity | Low |
| Effort | 2-3 hours |

**Note:** The `researcher.yaml` persona partially covers web search, but agent_brad's `WebSearchAgent` has specific patterns for search-first workflows.

---

## 4. Dependencies and API Keys

### 4.1 Required API Keys

| API | Purpose | Status | Migration Action |
|-----|---------|--------|------------------|
| `FINANCIAL_DATASETS_API_KEY` | Financial data (primary) | Required | Already used in agent_brad |
| `ALPHAVANTAGE_API_KEY` | Financial data (fallback) | Required | Already in summon finance skill |
| `EXASEARCH_API_KEY` | Web search | Required | Already in summon web-search skill |
| `TAVILY_API_KEY` | Web search | Required | Already in summon web-search skill |

### 4.2 Environment Variables

```bash
# Required (for full functionality)
export FINANCIAL_DATASETS_API_KEY="your-key-here"
export ALPHAVANTAGE_API_KEY="your-key-here"
export EXASEARCH_API_KEY="your-key-here"
export TAVILY_API_KEY="your-key-here"

# Optional (data source selection)
export FINANCIAL_DATA_SOURCE="financialdatasets"  # or "alphavantage"
```

### 4.3 Existing Dependencies in summon

- `zod` - Schema validation (already in use)
- `@langchain/core` - Tool definitions (already in use)
- `fs` - File system operations (Node.js built-in)

---

## 5. Migration Execution Order

### Phase 1: File Operations (Week 1, Days 1-2)

**Goal:** Add file operations capability to summon

1. Create file skill directory structure
   ```
   src/builtin/skills/file/
   ├── index.ts          # Tool implementations
   └── file.yaml         # Skill definition
   ```

2. Implement file tools (copy from agent_brad):
   - `read_file`
   - `write_file`
   - `list_directory`
   - `create_directory`

3. Update skill YAML with:
   - Capabilities list
   - Trigger keywords (write, read, file, directory)
   - Prompt fragment for file operations

4. Test file operations in isolation

**Deliverable:** File skill with 4 tools

### Phase 2: Enhanced Finance Tools - Part A (Week 1, Days 3-5)

**Goal:** Add high-value missing financial tools

1. Update `src/builtin/skills/finance/index.ts`:
   - Add `get_crypto_price_snapshot`
   - Add `get_crypto_prices`
   - Add `get_crypto_tickers`
   - Add `get_news`
   - Add `get_insider_trades`
   - Add `get_analyst_estimates`

2. Update `src/builtin/skills/finance/finance.yaml`:
   - Add new capabilities
   - Add new trigger keywords
   - Expand prompt fragment

3. Test all new tools

**Deliverable:** Enhanced finance skill with 10 total tools

### Phase 3: Enhanced Finance Tools - Part B (Week 2, Days 1-3)

**Goal:** Add SEC filings and fundamentals

1. Update `src/builtin/skills/finance/index.ts`:
   - Add `get_filings`
   - Add `get_10K_filing_items`
   - Add `get_10Q_filing_items`
   - Add `get_8K_filing_items`
   - Add income statements
   - Add balance sheets
   - Add cash flow statements
   - Add segmented revenues

2. Update `src/builtin/skills/finance/finance.yaml`:
   - Add SEC filings capabilities
   - Add fundamentals capabilities
   - Add segmented revenue capabilities

3. Test all filing tools

**Deliverable:** Complete finance skill with 18+ tools

### Phase 4: Personas (Week 2, Days 4-5)

**Goal:** Add specialized personas

1. Create `src/builtin/personas/file-agent.yaml`:
   - Based on agent_brad's `FileAgent`
   - Simple file write instructions
   - Auto-naming from content

2. Optionally enhance `researcher.yaml` or create web-search persona:
   - Based on agent_brad's `WebSearchAgent`
   - Search-first workflow
   - Result synthesis

3. Test persona interactions

**Deliverable:** 2 new personas

### Phase 5: Integration Testing (Week 3, Days 1-2)

**Goal:** Ensure everything works together

1. Test tool registration and availability
2. Test persona-tool interactions
3. Test error handling and edge cases
4. Verify API key fallback behavior
5. Test without API keys (stub mode)

### Phase 6: Documentation (Week 3, Day 3)

**Goal:** Complete migration documentation

1. Update SKILL.md if needed
2. Update TOOLS.md with new tools
3. Document API key requirements
4. Create example usage patterns

---

## 6. Estimated Effort Summary

| Phase | Tasks | Estimated Hours | Notes |
|-------|-------|-----------------|-------|
| Phase 1: File Operations | 4 tools + skill | 8-12 hours | Straightforward implementations |
| Phase 2a: Crypto & News | 3 crypto + 1 news | 6-9 hours | Simple API calls |
| Phase 2b: Insider & Estimates | 2 tools | 6-8 hours | Medium complexity |
| Phase 3a: Filings | 4 tools | 14-18 hours | Complex schemas |
| Phase 3b: Fundamentals | 4 tools | 8-12 hours | Standard API calls |
| Phase 4: Personas | 2 personas | 4-6 hours | YAML definitions |
| Phase 5: Testing | Integration | 8-10 hours | Thorough testing |
| Phase 6: Documentation | Docs | 2-4 hours | Final polish |
| **TOTAL** | **~26 tools + 2 personas** | **56-79 hours** | **~2-3 weeks** |

---

## 7. Technical Considerations

### 7.1 API Consolidation

**Current situation:**
- agent_brad uses `callApi()` function with data source selection
- summon finance skill uses direct Alpha Vantage calls
- Inconsistency in error handling and response formatting

**Recommendation:**
1. Move `api.ts` from agent_brad to shared location or import into summon
2. Or refactor to use consistent API patterns
3. Maintain dual support (Financial Datasets + Alpha Vantage)

### 7.2 Tool Naming Conventions

**In agent_brad:**
- `get_price_snapshot`, `get_prices`, `get_crypto_price_snapshot`

**In summon:**
- `financial_search` (unified), `web_search`

**Recommendation:**
- Keep individual tools (e.g., `get_price_snapshot`) alongside unified `financial_search`
- Maintain naming consistency: `get_*` for individual, `search` for unified

### 7.3 Stub Data

**Current situation:**
- agent_brad has minimal stub data (stub implementations in some tools)
- summon finance skill has stub implementations for missing API keys

**Recommendation:**
- Keep stub implementations for development/testing
- Document when stubs are active (missing API keys)

### 7.4 Security Considerations

- File operations have path safety checks in agent_brad (`isAllowedPath`)
- Reuse these checks in summon file skill
- Consider restricting file operations to workspace directory

---

## 8. Rollback Plan

If issues arise during migration:

1. **Phase-by-phase backup:** Keep original files until phase is verified
2. **Feature flags:** Use environment variables to enable/disable migrated features
3. **Gradual rollout:** Enable migrated tools one at a time
4. **Quick revert:** Original agent_brad remains unchanged until full migration complete

---

## 9. Post-Migration Tasks

1. **Deprecation of agent_brad:**
   - Archive or remove agent_brad after successful migration
   - Update any references to agent_brad in documentation

2. **Monitoring:**
   - Monitor API usage and costs
   - Track tool success rates
   - Gather user feedback on new capabilities

3. **Future enhancements:**
   - Add more sophisticated financial analysis
   - Consider AI-powered financial insights
   - Expand crypto coverage

---

## 10. Files Reference

### Files to Create in summon

```
src/builtin/skills/file/
├── index.ts          # File tool implementations
└── file.yaml         # Skill definition

src/builtin/personas/
└── file-agent.yaml   # File agent persona
```

### Files to Modify in summon

```
src/builtin/skills/finance/index.ts    # Add 14+ new tools
src/builtin/skills/finance/finance.yaml # Update capabilities
src/builtin/personas/researcher.yaml   # Optional enhancement
```

### Source Files to Reference (from agent_brad)

```
src/tools/file/
├── index.ts
├── read-file.ts
├── write-file.ts
├── list-directory.ts
├── create-directory.ts
└── config.ts

src/tools/finance/
├── api.ts              # API integration
├── crypto.ts
├── news.ts
├── insider_trades.ts
├── estimates.ts
├── filings.ts
├── fundamentals.ts
├── segments.ts
└── prices.ts

src/agent/specialists/
├── file-agent.ts
└── web-search-agent.ts (for persona patterns)
```

---

## Conclusion

This migration plan provides a structured approach to moving agent_brad's capabilities to the summon framework. The migration is feasible within 2-3 weeks and will significantly enhance summon's financial data capabilities.

**Key benefits of migration:**
- Unified skill/persona architecture
- Better maintainability
- Consistent tool registration
- Easier extensibility
- Reduced duplication

**Critical success factors:**
- API key availability for testing
- Thorough integration testing
- Gradual rollout with rollback capability
- Clear documentation
