#!/bin/bash
# ============================================================
# Coca-Cola Q4 2025 Earnings Analysis
# Using: financial-researcher-graduated (⭐⭐⭐⭐)
# ============================================================

echo "🦞 Summon Financial Researcher — Coca-Cola Q4 2025 Analysis"
echo "============================================================"
echo ""

# Navigate to summon project
cd /Users/river/.openclaw/workspace/projects/summon

# Load credentials from summon-academy
echo "📋 Loading credentials..."
export $(grep -v '^#' /Users/river/.openclaw/workspace/projects/summon-academy/.academy/credentials/agent_brad.env | xargs)

echo "✅ Credentials loaded"
echo "   - AlphaVantage: ${ALPHAVANTAGE_API_KEY:0:8}..."
echo "   - Tavily: ${TAVILY_API_KEY:0:8}..."
echo "   - OpenRouter: ${OPENAI_API_KEY:0:12}..."
echo ""

# Ritual path
RITUAL_PATH="/Users/river/.openclaw/workspace/projects/summon-academy/rituals/single-agent/financial-researcher-graduated/ritual.yaml"

echo "🎓 Agent: financial-researcher-graduated v2.0.0"
echo "   Status: ✅ Production Ready (4-star)"
echo "   Source: agent_brad acquisition"
echo "   Tools: AlphaVantage + Tavily"
echo ""

# The Analysis Query
QUERY="Analyze Coca-Cola (KO) Q4 2025 earnings. Include: 
1) Revenue and EPS vs consensus estimates
2) Key business segment performance (North America, International, Bottling)
3) Guidance for 2026 and management commentary
4) Recent analyst rating changes
5) Stock performance and valuation metrics (P/E, dividend yield)"

echo "🎯 Analysis Query:"
echo "   $QUERY"
echo ""
echo "---"
echo ""

# Execute summon command
echo "🔮 Summoning agent..."
echo ""

# Run the summon command with proper flags
bun run src/cli/index.ts run "$QUERY" \
  --ritual "$RITUAL_PATH" \
  --verbose

echo ""
echo "---"
echo ""
echo "✅ Analysis complete!"
echo ""
echo "📊 Report saved to: ~/.summon_mem/sessions/"
echo ""
echo "Next steps:"
echo "   - Review the full analysis above"
echo "   - Check session history: summon sessions list"
echo "   - Export to PDF: summon export --format pdf <session-id>"