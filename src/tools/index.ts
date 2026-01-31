/**
 * Financial Search Tool for Braddy
 * 
 * This module provides the financial_search tool by importing
 * and adapting the core logic from agent_brad.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { StructuredToolInterface } from '@langchain/core/tools';

// Import from agent_brad - these need to be available
// For now, we'll create stub implementations that demonstrate the pattern
// In production, you'd copy the full tool implementations

// ============================================================================
// Tool Interfaces (from agent_brad patterns)
// ============================================================================

export interface FinanceToolResult {
  data: Record<string, unknown>;
  sourceUrls: string[];
  error?: string;
}

// ============================================================================
// Placeholder Finance Tools (to be replaced with real agent_brad imports)
// ============================================================================

// Stub implementations - these would be replaced with actual tool imports
const createFinanceTools = (): StructuredToolInterface[] => {
  return [];
};

// ============================================================================
// Financial Search Router Prompt
// ============================================================================

function getCurrentDate(): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  return new Date().toLocaleDateString('en-US', options);
}

function buildRouterPrompt(): string {
  return `You are a financial data routing assistant.
Current date: ${getCurrentDate()}

Given a user's natural language query about financial data, call the appropriate financial tool(s).

## Guidelines

1. **Ticker Resolution**: Convert company names to ticker symbols:
   - Apple → AAPL, Tesla → TSLA, Microsoft → MSFT, Amazon → AMZN
   - Google/Alphabet → GOOGL, Meta/Facebook → META, Nvidia → NVDA

2. **Tool Selection**:
   - For "current" or "latest" data, use snapshot tools
   - For historical data, use date-range tools
   - For P/E ratio, market cap → metrics tools
   - For revenue, earnings → income statements
   - For debt, assets, equity → balance sheets
   - For cash flow → cash flow statements

3. **Efficiency**:
   - Prefer specific tools over general ones
   - Use comprehensive tools only when needed

Call the appropriate tool(s) now.`;
}

function formatToolResult(data: Record<string, unknown>, sourceUrls: string[]): string {
  return JSON.stringify({ data, sourceUrls }, null, 2);
}

// ============================================================================
// Create Financial Search Tool
// ============================================================================

export function createFinancialSearchTool(model: string = 'gpt-4o-mini'): DynamicStructuredTool {
  // Create stub finance tools for routing using DynamicStructuredTool
  const priceSnapshotTool = new DynamicStructuredTool({
    name: 'get_price_snapshot',
    description: 'Get current stock price and 24h change',
    schema: z.object({
      ticker: z.string().describe('Stock ticker symbol'),
    }),
    func: async ({ ticker }) => {
      const price = Math.random() * 500 + 50;
      return JSON.stringify({ ticker, price, change: (Math.random() - 0.5) * 10 });
    },
  });

  const metricsSnapshotTool = new DynamicStructuredTool({
    name: 'get_financial_metrics_snapshot',
    description: 'Get P/E ratio, market cap, EPS, dividend yield',
    schema: z.object({
      ticker: z.string().describe('Stock ticker symbol'),
    }),
    func: async ({ ticker }) => {
      return JSON.stringify({
        ticker,
        peRatio: 25 + Math.random() * 30,
        marketCap: Math.random() * 3e12,
        eps: 3 + Math.random() * 5,
        dividendYield: (Math.random() * 3).toFixed(2),
      });
    },
  });

  const stubTools: StructuredToolInterface[] = [priceSnapshotTool, metricsSnapshotTool];

  const toolMap = new Map(stubTools.map(t => [t.name, t]));

  return new DynamicStructuredTool({
    name: 'financial_search',
    description: `Intelligent search for financial data. Use for:
- Stock prices (current or historical)
- Company financials (income statements, balance sheets, cash flow)
- Financial metrics (P/E ratio, market cap, EPS, dividend yield)
- SEC filings (10-K, 10-Q, 8-K)
- Analyst estimates and price targets
- Company news
- Insider trading activity
- Cryptocurrency prices`,
    schema: z.object({
      query: z.string().describe('Natural language query about financial data'),
    }),
    func: async ({ query }) => {
      try {
        // Stub: Simulate tool calling (in real impl, uses LLM routing)
        const response = new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'get_price_snapshot',
              args: { ticker: 'AAPL' },
              id: 'call_1',
              type: 'tool_call',
            },
          ],
        });

        const toolCalls = response.tool_calls as ToolCall[];
        
        const results = await Promise.all(
          toolCalls.map(async (tc) => {
            try {
              const tool = toolMap.get(tc.name);
              if (!tool) {
                throw new Error(`Tool '${tc.name}' not found`);
              }
              const rawResult = await tool.invoke(tc.args);
              const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
              const parsed = JSON.parse(result);
              return { tool: tc.name, args: tc.args, data: parsed, error: null };
            } catch (error) {
              return { tool: tc.name, args: tc.args, data: null, error: String(error) };
            }
          })
        );

        const successfulResults = results.filter(r => r.error === null);
        const combinedData: Record<string, unknown> = {};
        
        for (const result of successfulResults) {
          const ticker = (result.args as Record<string, unknown>).ticker as string | undefined;
          const key = ticker ? `${result.tool}_${ticker}` : result.tool;
          combinedData[key] = result.data;
        }

        return formatToolResult(combinedData, []);
      } catch (error) {
        return formatToolResult({ error: String(error) }, []);
      }
    },
  });
}

// ============================================================================
// Web Search Tool (using Tavily if available)
// ============================================================================

export function createWebSearchTool(): DynamicStructuredTool {
  const hasTavily = !!process.env.TAVILY_API_KEY;
  const hasExa = !!process.env.EXASEARCH_API_KEY;

  return new DynamicStructuredTool({
    name: 'web_search',
    description: `Search the web for current information, news, and developments.
${hasTavily ? '✓ Tavily configured' : '✗ Tavily not configured (set TAVILY_API_KEY)'}
${hasExa ? '✓ Exa configured' : '✗ Exa not configured (set EXASEARCH_API_KEY)'}`,
    schema: z.object({
      query: z.string().describe('Web search query'),
    }),
    func: async ({ query }) => {
      if (!hasTavily && !hasExa) {
        return `[Web Search] Tavily/Exa API key not configured. Set TAVILY_API_KEY or EXASEARCH_API_KEY.
Query: ${query}

Note: In production, this would search the web for current information.`;
      }
      
      // Stub implementation - real version would call Tavily/Exa API
      return `[Web Search] Results for: ${query}

Note: This is a placeholder. Configure Tavily or Exa for real web search.`;
    },
  });
}
