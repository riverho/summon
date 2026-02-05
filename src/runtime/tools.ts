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
// Stub tools (for local testing / demos)
//
// IMPORTANT:
// - These are intentionally lightweight + deterministic.
// - They exist so compositions can bind tools without wiring real APIs yet.
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  query: z.string().optional().describe('Natural language query'),
});

function register(tool: StructuredToolInterface, description: string) {
  globalToolRegistry.register({
    name: tool.name,
    tool,
    description,
  });
}

// Financial search (stub)
const financialSearchTool = new DynamicStructuredTool({
  name: 'financial_search',
  description: 'Search for financial data (stub).',
  schema: QuerySchema,
  func: async (input: z.infer<typeof QuerySchema>) => {
    const query = input?.query ?? 'Unknown';
    const upperQuery = query.toUpperCase();

    if (upperQuery.includes('AAPL') || upperQuery.includes('APPLE')) {
      return JSON.stringify({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        price: 178.50,
        change: 2.34,
        marketCap: '2.8T',
        peRatio: 28.5,
        eps: 6.25,
        revenue: '416.2B',
        netIncome: '97.0B',
        lastUpdated: new Date().toISOString(),
      });
    }

    if (upperQuery.includes('MSFT') || upperQuery.includes('MICROSOFT')) {
      return JSON.stringify({
        symbol: 'MSFT',
        name: 'Microsoft Corporation',
        price: 378.91,
        change: -1.23,
        marketCap: '2.8T',
        peRatio: 35.2,
        eps: 10.75,
        revenue: '211.9B',
        netIncome: '72.4B',
        lastUpdated: new Date().toISOString(),
      });
    }

    if (upperQuery.includes('GOOG') || upperQuery.includes('GOOGLE') || upperQuery.includes('ALPHABET')) {
      return JSON.stringify({
        symbol: 'GOOGL',
        name: 'Alphabet Inc.',
        price: 141.80,
        change: 0.87,
        marketCap: '1.7T',
        peRatio: 24.1,
        eps: 5.88,
        revenue: '307.4B',
        netIncome: '73.8B',
        lastUpdated: new Date().toISOString(),
      });
    }

    return JSON.stringify({
      query,
      message: 'Financial data not available for this query',
      suggestion: 'Try searching for specific stocks like AAPL, MSFT, or GOOGL',
      lastUpdated: new Date().toISOString(),
    });
  },
});

register(
  financialSearchTool,
  `Search for financial data including stock prices, company fundamentals, and market information.

**When to use:**
- User asks about stock prices, market cap, P/E ratios
- User wants financial metrics or company fundamentals
- User needs earnings data or revenue information

**When NOT to use:**
- General knowledge questions about companies
- Questions not related to financial markets

**Example inputs:**
- {"query": "AAPL stock price"}
- {"query": "Microsoft revenue 2024"}
- {"query": "Tesla P/E ratio"}`
);

// Web search (stub)
const webSearchTool = new DynamicStructuredTool({
  name: 'web_search',
  description: 'Search the web (stub).',
  schema: QuerySchema,
  func: async (input: z.infer<typeof QuerySchema>) => {
    const query = input?.query ?? 'Unknown';
    const upperQuery = query.toUpperCase();

    if (upperQuery.includes('AAPL') || upperQuery.includes('APPLE')) {
      return JSON.stringify({
        query,
        results: [
          {
            title: 'Apple Announces New AI Features',
            source: 'TechNews',
            url: 'https://example.com/apple-ai',
            date: new Date().toISOString(),
            summary: 'Apple unveiled new AI-powered features for iPhone and Mac.',
          },
          {
            title: 'Apple Q4 Earnings Beat Expectations',
            source: 'Financial Times',
            url: 'https://example.com/apple-earnings',
            date: new Date().toISOString(),
            summary: 'Apple reported record revenue for the fourth quarter.',
          },
        ],
        lastUpdated: new Date().toISOString(),
      });
    }

    return JSON.stringify({
      query,
      results: [
        {
          title: 'Search Results',
          source: 'Web Search',
          url: 'https://example.com/search',
          date: new Date().toISOString(),
          summary: `Found results for: ${query}`,
        },
      ],
      lastUpdated: new Date().toISOString(),
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

// File read/write (stubs)
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

// Failing tool for retry testing (fails twice, succeeds third time)
const failingTool = new DynamicStructuredTool({
  name: 'failing_tool',
  description: 'A tool that fails and retries for testing purposes.',
  schema: QuerySchema,
  func: (() => {
    let attemptCount = 0;
    return async (_input: z.infer<typeof QuerySchema>) => {
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
