/**
 * Financial Search Tool for Summon
 * 
 * Real AlphaVantage API integration for stock data
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { StructuredToolInterface } from '@langchain/core/tools';

// ============================================================================
// AlphaVantage API Integration
// ============================================================================

const ALPHAVANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

interface AlphaVantageQuote {
  'Global Quote'?: {
    '01. symbol': string;
    '02. open': string;
    '03. high': string;
    '04. low': string;
    '05. price': string;
    '06. volume': string;
    '07. latest trading day': string;
    '08. previous close': string;
    '09. change': string;
    '10. change percent': string;
  };
  'Note'?: string;
  'Information'?: string;
}

async function fetchAlphaVantageQuote(ticker: string, apiKey: string): Promise<AlphaVantageQuote> {
  const url = `${ALPHAVANTAGE_BASE_URL}?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`AlphaVantage API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function extractTicker(query: string): string | null {
  // Common company name to ticker mappings
  const nameMap: Record<string, string> = {
    'apple': 'AAPL',
    'tesla': 'TSLA',
    'microsoft': 'MSFT',
    'amazon': 'AMZN',
    'google': 'GOOGL',
    'alphabet': 'GOOGL',
    'meta': 'META',
    'facebook': 'META',
    'nvidia': 'NVDA',
    'netflix': 'NFLX',
    'amd': 'AMD',
    'intel': 'INTC',
  };
  
  const lowerQuery = query.toLowerCase();
  
  // Check for company names
  for (const [name, ticker] of Object.entries(nameMap)) {
    if (lowerQuery.includes(name)) {
      return ticker;
    }
  }
  
  // Check for ticker symbols (2-5 uppercase letters)
  const tickerMatch = query.match(/\b([A-Z]{2,5})\b/);
  if (tickerMatch) {
    return tickerMatch[1];
  }
  
  return null;
}

// ============================================================================
// Create Financial Search Tool
// ============================================================================

export function createFinancialSearchTool(_model: string = 'gpt-4o-mini'): DynamicStructuredTool {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  const hasApiKey = !!apiKey;

  return new DynamicStructuredTool({
    name: 'financial_search',
    description: `Search for real-time stock prices and financial data using AlphaVantage.

Use this tool for:
- Current stock prices (e.g., "What's AAPL price?")
- Stock quotes with open/high/low/close/volume
- Daily trading data

${hasApiKey ? '✓ AlphaVantage configured' : '✗ AlphaVantage not configured (set ALPHAVANTAGE_API_KEY)'}

Examples:
- "What is Tesla stock price?" → returns current TSLA quote
- "AAPL current price" → returns Apple stock data`,
    schema: z.object({
      query: z.string().describe('Natural language query about stock price or financial data'),
    }),
    func: async ({ query }) => {
      console.log(`[DEBUG] Financial search query: "${query}"`);
      
      if (!hasApiKey) {
        return JSON.stringify({
          error: 'AlphaVantage API key not configured',
          message: 'Set ALPHAVANTAGE_API_KEY environment variable',
          query,
        });
      }

      const ticker = extractTicker(query);
      console.log(`[DEBUG] Extracted ticker: ${ticker}`);
      
      if (!ticker) {
        return JSON.stringify({
          error: 'Could not extract ticker symbol from query',
          query,
          hint: 'Try using a ticker symbol (e.g., AAPL, TSLA) or company name (e.g., Apple, Tesla)',
        });
      }

      try {
        const data = await fetchAlphaVantageQuote(ticker, apiKey!);
        
        // Check for API limit/error messages
        if (data['Note']) {
          return JSON.stringify({
            error: 'AlphaVantage API limit reached',
            message: data['Note'],
            query,
            ticker,
          });
        }
        
        if (data['Information']) {
          return JSON.stringify({
            error: 'AlphaVantage API error',
            message: data['Information'],
            query,
            ticker,
          });
        }

        const quote = data['Global Quote'];
        if (!quote) {
          return JSON.stringify({
            error: 'No data found for ticker',
            ticker,
            query,
          });
        }

        return JSON.stringify({
          ticker: quote['01. symbol'],
          price: parseFloat(quote['05. price']),
          open: parseFloat(quote['02. open']),
          high: parseFloat(quote['03. high']),
          low: parseFloat(quote['04. low']),
          volume: parseInt(quote['06. volume']),
          latestTradingDay: quote['07. latest trading day'],
          previousClose: parseFloat(quote['08. previous close']),
          change: parseFloat(quote['09. change']),
          changePercent: quote['10. change percent'],
          source: 'AlphaVantage',
        });
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to fetch financial data',
          message: String(error),
          query,
          ticker,
        });
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

// ============================================================================
// Tool Exports
// ============================================================================

export function createFinanceTools(): StructuredToolInterface[] {
  return [
    createFinancialSearchTool(),
    createWebSearchTool(),
  ];
}
