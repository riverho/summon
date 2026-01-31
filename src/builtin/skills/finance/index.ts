/**
 * Finance Skill Module
 * 
 * Self-contained skill for financial data using Alpha Vantage API.
 * Registers financial_search tool with the global registry.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { globalToolRegistry } from '../../../runtime/tools.js';

// ============================================================================
// API Configuration
// ============================================================================

const ALPHAVANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

function getAlphaVantageKey(): string | null {
  return process.env.ALPHAVANTAGE_API_KEY?.trim() || null;
}

function hasAlphaVantageKey(): boolean {
  return Boolean(getAlphaVantageKey());
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[%,$]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

// ============================================================================
// API Calls
// ============================================================================

async function callAlphaVantage(params: Record<string, string>): Promise<Record<string, unknown>> {
  const apiKey = getAlphaVantageKey();
  if (!apiKey) {
    throw new Error('ALPHAVANTAGE_API_KEY not configured');
  }

  const url = new URL(ALPHAVANTAGE_BASE_URL);
  url.searchParams.set('apikey', apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  if (data.Error_Message) {
    throw new Error(String(data.Error_Message));
  }
  if (data.Note) {
    throw new Error(String(data.Note));
  }
  return data;
}

// ============================================================================
// Tool: Price Snapshot
// ============================================================================

const createPriceSnapshotTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'get_price_snapshot',
    description: 'Get current stock price, market cap, and 24h change',
    schema: z.object({
      ticker: z.string().describe('Stock ticker symbol (e.g., AAPL, MSFT, GOOGL)'),
    }),
    func: async ({ ticker }) => {
      if (!hasAlphaVantageKey()) {
        return JSON.stringify({
          ticker,
          price: (100 + Math.random() * 200).toFixed(2),
          change: (Math.random() * 10 - 5).toFixed(2),
          changePercent: ((Math.random() - 0.5) * 5).toFixed(2),
          source: 'stub',
          message: 'Using stub data. Set ALPHAVANTAGE_API_KEY for real data.',
        });
      }

      const data = await callAlphaVantage({
        function: 'GLOBAL_QUOTE',
        symbol: ticker.toUpperCase(),
      });

      const quote = (data['Global Quote'] ?? {}) as Record<string, string>;
      return JSON.stringify({
        symbol: quote['01. symbol'] ?? ticker,
        price: parseNumber(quote['05. price']),
        open: parseNumber(quote['02. open']),
        high: parseNumber(quote['03. high']),
        low: parseNumber(quote['04. low']),
        volume: parseNumber(quote['06. volume']),
        previous_close: parseNumber(quote['08. previous close']),
        change: parseNumber(quote['09. change']),
        change_percent: quote['10. change percent'],
        latest_trading_day: quote['07. latest trading day'],
        source: 'alphavantage',
      });
    },
  });
};

// ============================================================================
// Tool: Financial Metrics (P/E, EPS, etc.)
// ============================================================================

const createMetricsSnapshotTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'get_financial_metrics_snapshot',
    description: 'Get key financial metrics: P/E ratio, EPS, dividend yield, market cap',
    schema: z.object({
      ticker: z.string().describe('Stock ticker symbol'),
    }),
    func: async ({ ticker }) => {
      if (!hasAlphaVantageKey()) {
        return JSON.stringify({
          ticker,
          peRatio: (20 + Math.random() * 30).toFixed(2),
          eps: (3 + Math.random() * 5).toFixed(2),
          dividendYield: (Math.random() * 3).toFixed(2),
          marketCap: (Math.random() * 3e12).toFixed(0),
          source: 'stub',
          message: 'Using stub data. Set ALPHAVANTAGE_API_KEY for real data.',
        });
      }

      const data = await callAlphaVantage({
        function: 'OVERVIEW',
        symbol: ticker.toUpperCase(),
      });

      const overview = data as Record<string, string>;
      return JSON.stringify({
        symbol: overview.Symbol ?? ticker,
        name: overview.Name,
        exchange: overview.Exchange,
        currency: overview.Currency,
        marketCap: parseNumber(overview.MarketCapitalization),
        peRatio: parseNumber(overview.PERatio),
        forwardPe: parseNumber(overview.ForwardPE),
        eps: parseNumber(overview.EPS),
        dividendYield: parseNumber(overview.DividendYield),
        beta: parseNumber(overview.Beta),
        fiftyTwoWeekHigh: parseNumber(overview['52WeekHigh']),
        fiftyTwoWeekLow: parseNumber(overview['52WeekLow']),
        source: 'alphavantage',
      });
    },
  });
};

// ============================================================================
// Helper Functions
// ============================================================================

function extractTicker(query: string): string | undefined {
  const tickerMatch = query.match(/\b[A-Z]{1,5}\b/);
  return tickerMatch?.[0];
}

// ============================================================================
// Skill Definition
// ============================================================================

export const financeSkill = {
  id: 'finance',
  name: 'Financial Data',
  capabilities: [
    'Stock prices and historical data',
    'Financial metrics (P/E, margins, growth rates)',
    'Company fundamentals and valuations',
  ],
  requiredTools: ['financial_search'],
  triggerKeywords: [
    'stock', 'price', 'revenue', 'earnings', 'P/E', 'EPS',
    'dividend', 'market cap', 'valuation', 'financial',
  ],
  promptFragment: `You can retrieve financial data including:
- Stock prices with 24h changes
- Key financial metrics (P/E, EPS, dividend yield, market cap)
- Company overview and fundamentals

Always cite sources. Never fabricate numbers. Use tables for comparisons.`,
};

// ============================================================================
// Tool Registration (called on module load)
// ============================================================================

globalToolRegistry.register({
  name: 'financial_search',
  tool: new DynamicStructuredTool({
    name: 'financial_search',
    description: 'Search for financial data: stock prices, P/E ratio, revenue, earnings, market metrics. Uses Alpha Vantage API.',
    schema: z.object({
      query: z.string().describe('Natural language financial query (e.g., "AAPL stock price", "MSFT P/E ratio")'),
    }),
    func: async ({ query }) => {
      const ticker = extractTicker(query) || 'AAPL';
      const lowerQuery = query.toLowerCase();

      // Route to appropriate tool based on keywords
      if (lowerQuery.includes('price') || lowerQuery.includes('trading') || lowerQuery.includes('market cap')) {
        return await createPriceSnapshotTool().invoke({ ticker });
      }
      if (lowerQuery.includes('p/e') || lowerQuery.includes('eps') || lowerQuery.includes('dividend') || lowerQuery.includes('metric')) {
        return await createMetricsSnapshotTool().invoke({ ticker });
      }

      // Default to price snapshot
      return await createPriceSnapshotTool().invoke({ ticker });
    },
  }),
  description: 'Search for financial data: stock prices, P/E ratio, revenue, earnings, and market metrics using Alpha Vantage API.',
});

