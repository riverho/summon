import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod/v3';

/**
 * A registered tool with its rich description for system prompt injection.
 */
export interface RegisteredTool {
  /** Tool name (must match the tool's name property) */
  name: string;
  /** The actual tool instance */
  tool: StructuredToolInterface;
  /** Rich description for system prompt (includes when to use, when not to use, etc.) */
  description: string;
}

/**
 * Tool registry for managing available tools.
 * Skills declare required tools, and the composer binds only those tools.
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a tool in the registry.
   */
  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by names (for skill-based binding).
   */
  getByNames(names: string[]): RegisteredTool[] {
    return names
      .map(name => this.tools.get(name))
      .filter((tool): tool is RegisteredTool => tool !== undefined);
  }

  /**
   * Get tool instances only (for binding to LLM).
   */
  getToolInstances(names?: string[]): StructuredToolInterface[] {
    const tools = names ? this.getByNames(names) : this.getAll();
    return tools.map(t => t.tool);
  }

  /**
   * Build tool descriptions section for system prompt.
   */
  buildToolDescriptions(names?: string[]): string {
    const tools = names ? this.getByNames(names) : this.getAll();
    return tools
      .map((t) => `### ${t.name}\n\n${t.description}`)
      .join('\n\n');
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool names.
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

// Global tool registry instance
export const globalToolRegistry = new ToolRegistry();

// ---------------------------------------------------------------------------
// Real API Tools (AlphaVantage, Tavily)
// ---------------------------------------------------------------------------

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
  
  for (const [name, ticker] of Object.entries(nameMap)) {
    if (lowerQuery.includes(name)) {
      return ticker;
    }
  }
  
  const tickerMatch = query.match(/\b([A-Z]{2,5})\b/);
  if (tickerMatch) {
    return tickerMatch[1];
  }
  
  return null;
}

function register(tool: StructuredToolInterface, description: string) {
  globalToolRegistry.register({
    name: tool.name,
    tool,
    description,
  });
}

// Real Financial Search Tool (AlphaVantage)
const financialSearchTool = new DynamicStructuredTool({
  name: 'financial_search',
  description: 'Search for real-time stock prices and financial data using AlphaVantage API.',
  schema: z.object({
    query: z.string().describe('Natural language query about stock price or financial data (e.g., "What is Tesla stock price?")'),
  }),
  func: async ({ query }: { query: string }) => {
    const apiKey = process.env.ALPHAVANTAGE_API_KEY;
    
    if (!apiKey) {
      return JSON.stringify({
        error: 'AlphaVantage API key not configured',
        message: 'Set ALPHAVANTAGE_API_KEY environment variable',
        query,
      });
    }

    const ticker = extractTicker(query);
    if (!ticker) {
      return JSON.stringify({
        error: 'Could not extract ticker symbol from query',
        query,
        hint: 'Try using a ticker symbol (e.g., AAPL, TSLA) or company name (e.g., Apple, Tesla)',
      });
    }

    try {
      const data = await fetchAlphaVantageQuote(ticker, apiKey);
      
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

register(
  financialSearchTool,
  `Search for real-time stock prices and financial data using AlphaVantage API.

**When to use:**
- User asks for current stock price
- User wants financial metrics (P/E, market cap, etc.)
- User asks about specific companies by name or ticker

**When NOT to use:**
- General company information (use web_search)
- Historical analysis beyond latest data

**Example inputs:**
- {"query": "What is AAPL price?"}
- {"query": "Tesla stock"}
- {"query": "Current price of Microsoft"}`
);

// Web Search Tool (Tavily/Exa)
const webSearchTool = new DynamicStructuredTool({
  name: 'web_search',
  description: 'Search the web for current news and information.',
  schema: z.object({
    query: z.string().describe('Web search query'),
  }),
  func: async ({ query }: { query: string }) => {
    const hasTavily = !!process.env.TAVILY_API_KEY;
    
    if (!hasTavily) {
      return JSON.stringify({
        error: 'Tavily API key not configured',
        message: 'Set TAVILY_API_KEY for web search',
        query,
      });
    }
    
    // Placeholder - real implementation would call Tavily API
    return JSON.stringify({
      query,
      results: [],
      note: 'Web search requires Tavily API integration',
    });
  },
});

register(
  webSearchTool,
  `Search the web for current news, information, and events.

**When to use:**
- User asks for current news or recent events
- User wants information that may have changed recently

**When NOT to use:**
- General knowledge questions with stable answers
- Historical facts

**Example inputs:**
- {"query": "Latest news about Tesla"}
- {"query": "Apple earnings announcement"}`
);

// File tools (stubs)
const fileReadTool = new DynamicStructuredTool({
  name: 'file_read',
  description: 'Read a file from local filesystem (stub).',
  schema: z.object({ path: z.string() }),
  func: async (input: { path: string }) => {
    return `[file_read stub] Cannot read file: ${input.path} (tool is a stub for testing)`;
  },
});

register(
  fileReadTool,
  `Read the contents of a file from the local filesystem.

**When to use:**
- User asks to read a file
- User wants to analyze document contents

**Example inputs:**
- {"path": "/path/to/file.txt"}`
);

const fileWriteTool = new DynamicStructuredTool({
  name: 'file_write',
  description: 'Write a file to local filesystem (stub).',
  schema: z.object({ path: z.string(), content: z.string() }),
  func: async (input: { path: string; content: string }) => {
    return `[file_write stub] Cannot write file: ${input.path} (tool is a stub for testing)`;
  },
});

register(
  fileWriteTool,
  `Write content to a file on the local filesystem.

**When to use:**
- User asks to save information to a file
- User wants to export data/results

**Example inputs:**
- {"path": "/path/to/output.txt", "content": "Data to save"}`
);

// Failing tool for retry testing
const failingTool = new DynamicStructuredTool({
  name: 'failing_tool',
  description: 'A tool that fails and retries for testing purposes.',
  schema: z.object({ query: z.string().optional() }),
  func: (() => {
    let attemptCount = 0;
    return async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error(`[RETRY_TEST] Tool failed on attempt ${attemptCount}/3`);
      }
      return JSON.stringify({
        success: true,
        attempts: attemptCount,
        message: 'Tool succeeded on 3rd attempt after 2 retries',
      });
    };
  })(),
});

register(
  failingTool,
  `A tool that fails and retries for testing purposes.

**When to use:**
- Testing retry mechanism

**Example inputs:**
- {"query": "test"}`
);
