#!/bin/bash
# Coca-Cola Q4 2025 Earnings Analysis
# Uses: financial-researcher-graduated (4⭐ agent)

cd /Users/river/.openclaw/workspace/projects/summon

# Load credentials
export $(grep -v '^#' /Users/river/.openclaw/workspace/projects/summon-academy/.academy/credentials/agent_brad.env | xargs)

# The summon command
summon run "Analyze Coca-Cola (KO) Q4 2025 earnings. Include: 1) Revenue and EPS vs estimates, 2) Segment performance, 3) 2026 guidance, 4) Analyst ratings, 5) Valuation metrics" \
  --ritual /Users/river/.openclaw/workspace/projects/summon-academy/rituals/single-agent/financial-researcher-graduated/ritual.yaml \
  --verbose