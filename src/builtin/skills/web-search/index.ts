/**
 * Web Search Skill Module
 * 
 * Self-contained skill for web searching using Tavily or Exa API.
 * Registers web_search tool with the global registry.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { globalToolRegistry } from '../../../runtime/tools.js';

// ============================================================================
// API Configuration
// ============================================================================

const TAVILY_BASE_URL = 'https://api.tavily.com/search';
const EXA_BASE_URL = 'https://api.exa.com/search';

function getTavilyKey(): string | null {
  return process.env.TAVILY_API_KEY?.trim() || null;
}

function getExaKey(): string | null {
  return process.env.EXASEARCH_API_KEY?.trim() || null;
}

function hasTavilyKey(): boolean {
  return Boolean(getTavilyKey());
}

function hasExaKey(): boolean {
  return Boolean(getExaKey());
}

// ============================================================================
// API Calls
// ============================================================================

async function searchTavily(query: string): Promise<Record<string, unknown>[]> {
  const apiKey = getTavilyKey();
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY not configured');
  }

  const response = await fetch(TAVILY_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      include_answer: true,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
}

async function searchExa(query: string): Promise<Record<string, unknown>[]> {
  const apiKey = getExaKey();
  if (!apiKey) {
    throw new Error('EXASEARCH_API_KEY not configured');
  }

  const response = await fetch(EXA_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      num_results: 5,
      include_text: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Exa API error: ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
}

async function searchWeb(query: string): Promise<Record<string, unknown>[]> {
  // Prefer Tavily if available, otherwise Exa, otherwise stub
  if (hasTavilyKey()) {
    return searchTavily(query);
  }
  if (hasExaKey()) {
    return searchExa(query);
  }
  
  // Stub response when no API key
  return [
    {
      title: `Search Result for: ${query}`,
      url: 'https://example.com',
      snippet: 'This is stub data. Set TAVILY_API_KEY or EXASEARCH_API_KEY for real web search.',
      score: 0.9,
    },
  ];
}

// ============================================================================
// Skill Definition
// ============================================================================

export const webSearchSkill = {
  id: 'web-search',
  name: 'Web Search',
  capabilities: [
    'Current news and events',
    'Recent announcements',
    'General knowledge queries',
    'Fact-checking and verification',
  ],
  requiredTools: ['web_search'],
  triggerKeywords: [
    'news', 'latest', 'search', 'find', 'look up',
    'current', 'recent', 'announcement', 'trend',
  ],
  promptFragment: `You can search the web for current information on any topic.

Prioritize:
- Recent, authoritative sources
- Primary sources when available
- Multiple sources for verification

When using web search:
- Provide specific, well-formed search queries
- Cite sources with URLs when possible
- Note the recency of information`,
};

// ============================================================================
// Tool Registration
// ============================================================================

const hasTavily = hasTavilyKey();
const hasExa = hasExaKey();

globalToolRegistry.register({
  name: 'web_search',
  tool: new DynamicStructuredTool({
    name: 'web_search',
    description: `Search the web for current information, news, and developments.
${hasTavily ? '✓ Tavily configured' : '✗ Tavily not configured (set TAVILY_API_KEY)'}
${hasExa ? '✓ Exa configured' : '✗ Exa not configured (set EXASEARCH_API_KEY)'}`,
    schema: z.object({
      query: z.string().describe('Web search query'),
    }),
    func: async ({ query }) => {
      try {
        const results = await searchWeb(query);
        
        const formatted = results.map((r: Record<string, unknown>, i: number) => ({
          result_number: i + 1,
          title: r.title,
          url: r.url,
          snippet: r.snippet || r.content,
          score: r.score,
        }));

        return JSON.stringify({
          query,
          results: formatted,
          source: hasTavily ? 'tavily' : hasExa ? 'exa' : 'stub',
          count: formatted.length,
        });
      } catch (error) {
        return JSON.stringify({
          query,
          error: error instanceof Error ? error.message : String(error),
          source: 'error',
        });
      }
    },
  }),
  description: `Search the web for current information, news, and developments.
${hasTavily ? '✓ Tavily' : '✗ Tavily'}${hasExa ? '✓ Exa' : '✗ Exa'}`,
});

