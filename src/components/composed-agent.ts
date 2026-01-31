import { AIMessage } from '@langchain/core/messages';
import { StructuredToolInterface } from '@langchain/core/tools';
import { callLlm, getFastModel } from '../runtime/llm.js';
import { Scratchpad } from '../runtime/scratchpad.js';
import { InMemoryChatHistory } from '../runtime/memory.js';
import { ComposedAgentSpec } from './composer.js';
import type {
  AgentEvent,
  ToolStartEvent,
  ToolEndEvent,
  ToolErrorEvent,
  ComposedAgentConfig,
} from './types.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract text content from an AIMessage
 */
function extractTextContent(message: AIMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((block): block is { type: 'text'; text: string } =>
        typeof block === 'object' && block !== null && 'type' in block && block.type === 'text'
      )
      .map(block => block.text)
      .join('');
  }
  return '';
}

/**
 * Check if an AIMessage has tool calls
 */
function hasToolCalls(message: AIMessage): boolean {
  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

/**
 * Get tool description for display
 */
function getToolDescription(toolName: string, args: Record<string, unknown>): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  return `${toolName}(${argStr})`;
}

// ============================================================================
// Prompts
// ============================================================================

/**
 * Build user prompt for agent iteration with tool summaries
 */
function buildIterationPrompt(
  originalQuery: string,
  toolSummaries: string[],
  qualityPrompts: string[]
): string {
  const qualitySection = qualityPrompts.length > 0
    ? `\n\nQuality reflection before responding:\n${qualityPrompts.map(p => `- ${p}`).join('\n')}`
    : '';

  return `Query: ${originalQuery}

Data retrieved and work completed so far:
${toolSummaries.join('\n')}

Review the data above. If you have sufficient information to answer the query, respond directly WITHOUT calling any tools. Only call additional tools if there are specific data gaps that prevent you from answering.${qualitySection}`;
}

/**
 * Build the prompt for final answer generation with full context data
 */
function buildFinalAnswerPrompt(
  originalQuery: string,
  fullContextData: string,
  qualityChecklist: string[]
): string {
  const qualitySection = qualityChecklist.length > 0
    ? `\n\nBefore finalizing your answer, ensure:\n${qualityChecklist.map(c => `- ${c}`).join('\n')}`
    : '';

  return `Query: ${originalQuery}

Data retrieved from your tool calls:
${fullContextData}

Answer the user's query using this data. Do not ask the user to provide additional data, paste values, or reference JSON/API internals. If data is incomplete, answer with what you have.${qualitySection}`;
}

/**
 * Build prompt for LLM-generated tool result summaries
 */
function buildToolSummaryPrompt(
  originalQuery: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  result: string
): string {
  const argsStr = Object.entries(toolArgs).map(([k, v]) => `${k}=${v}`).join(', ');
  return `Summarize this tool result concisely.

Query: ${originalQuery}
Tool: ${toolName}(${argsStr})
Result:
${result}

Write a 1 sentence summary of what was retrieved. Include specific values (numbers, dates) if relevant.
Format: "[tool_call] -> [what was learned]"`;
}

// ============================================================================
// ComposedAgent Class
// ============================================================================

/**
 * Runtime agent that executes with a composed configuration
 */
export class ComposedAgent {
  private readonly spec: ComposedAgentSpec;
  private readonly signal?: AbortSignal;

  constructor(spec: ComposedAgentSpec, signal?: AbortSignal) {
    this.spec = spec;
    this.signal = signal;
  }

  /**
   * Create a ComposedAgent from a spec
   */
  static create(spec: ComposedAgentSpec, signal?: AbortSignal): ComposedAgent {
    return new ComposedAgent(spec, signal);
  }

  /**
   * Run the agent and yield events for real-time UI updates
   */
  async *run(query: string, inMemoryHistory?: InMemoryChatHistory): AsyncGenerator<AgentEvent> {
    if (this.spec.tools.length === 0) {
      yield {
        type: 'done',
        answer: 'No tools available. Please check your skill configuration and tool registry.',
        toolCalls: [],
        iterations: 0,
      };
      return;
    }

    const scratchpad = new Scratchpad(query);
    let currentPrompt = this.buildInitialPrompt(query, inMemoryHistory);
    let iteration = 0;

    while (iteration < this.spec.maxIterations) {
      iteration++;

      const response = await this.callModel(currentPrompt) as AIMessage;
      const responseText = extractTextContent(response);

      // Emit thinking if there are also tool calls
      if (responseText && hasToolCalls(response)) {
        scratchpad.addThinking(responseText);
        yield { type: 'thinking', message: responseText };
      }

      // No tool calls = ready to generate final answer
      if (!hasToolCalls(response)) {
        // If no tools were called at all, just use the direct response
        if (!scratchpad.hasToolResults() && responseText) {
          yield { type: 'answer_start' };
          yield { type: 'done', answer: responseText, toolCalls: [], iterations: iteration };
          return;
        }

        // Generate final answer with full context from scratchpad
        const fullContext = this.buildFullContextForAnswer(scratchpad);
        const qualityChecklist = this.spec.guardrails?.thinking.qualityChecklist ?? [];
        const finalPrompt = buildFinalAnswerPrompt(query, fullContext, qualityChecklist);

        yield { type: 'answer_start' };
        const finalResponse = await this.callModel(finalPrompt, false);
        const answer = typeof finalResponse === 'string'
          ? finalResponse
          : extractTextContent(finalResponse);

        yield {
          type: 'done',
          answer,
          toolCalls: scratchpad.getToolCallRecords(),
          iterations: iteration,
        };
        return;
      }

      // Execute tools and add results to scratchpad
      const generator = this.executeToolCalls(response, query, scratchpad);
      let result = await generator.next();

      while (!result.done) {
        yield result.value;
        result = await generator.next();
      }

      // Build iteration prompt from scratchpad
      const qualityPrompts = this.spec.workflow?.thinking.qualityPrompts ?? [];
      currentPrompt = buildIterationPrompt(query, scratchpad.getToolSummaries(), qualityPrompts);
    }

    // Max iterations reached - still generate proper final answer
    const fullContext = this.buildFullContextForAnswer(scratchpad);
    const qualityChecklist = this.spec.guardrails?.thinking.qualityChecklist ?? [];
    const finalPrompt = buildFinalAnswerPrompt(query, fullContext, qualityChecklist);

    yield { type: 'answer_start' };
    const finalResponse = await this.callModel(finalPrompt, false);
    const answer = typeof finalResponse === 'string'
      ? finalResponse
      : extractTextContent(finalResponse);

    yield {
      type: 'done',
      answer: answer || `Reached maximum iterations (${this.spec.maxIterations}).`,
      toolCalls: scratchpad.getToolCallRecords(),
      iterations: iteration,
    };
  }

  /**
   * Call the LLM with the current prompt
   */
  private async callModel(prompt: string, useTools: boolean = true): Promise<AIMessage | string> {
    return await callLlm(prompt, {
      model: this.spec.model,
      systemPrompt: this.spec.systemPrompt,
      tools: useTools ? this.spec.tools : undefined,
      signal: this.signal,
    }) as AIMessage | string;
  }

  /**
   * Generate an LLM summary of a tool result for context compaction
   */
  private async summarizeToolResult(
    query: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    result: string
  ): Promise<string> {
    const prompt = buildToolSummaryPrompt(query, toolName, toolArgs, result);
    const summary = await callLlm(prompt, {
      model: getFastModel(this.spec.provider, this.spec.model),
      systemPrompt: 'You are a concise data summarizer.',
      signal: this.signal,
    });
    return String(summary);
  }

  /**
   * Execute all tool calls from an LLM response
   */
  private async *executeToolCalls(
    response: AIMessage,
    query: string,
    scratchpad: Scratchpad
  ): AsyncGenerator<ToolStartEvent | ToolEndEvent | ToolErrorEvent, void> {
    for (const toolCall of response.tool_calls ?? []) {
      const toolName = toolCall.name;
      const toolArgs = toolCall.args as Record<string, unknown>;

      const generator = this.executeToolCall(toolName, toolArgs, query, scratchpad);
      let result = await generator.next();

      while (!result.done) {
        yield result.value;
        result = await generator.next();
      }
    }
  }

  /**
   * Execute a single tool call
   */
  private async *executeToolCall(
    toolName: string,
    toolArgs: Record<string, unknown>,
    query: string,
    scratchpad: Scratchpad
  ): AsyncGenerator<ToolStartEvent | ToolEndEvent | ToolErrorEvent, void> {
    yield { type: 'tool_start', tool: toolName, args: toolArgs };

    const startTime = Date.now();

    try {
      const tool = this.spec.toolMap.get(toolName);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      const rawResult = await tool.invoke(toolArgs, this.signal ? { signal: this.signal } : undefined);
      const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      const duration = Date.now() - startTime;

      yield { type: 'tool_end', tool: toolName, args: toolArgs, result, duration };

      // Generate LLM summary for context compaction
      const llmSummary = await this.summarizeToolResult(query, toolName, toolArgs, result);

      // Add complete tool result to scratchpad
      scratchpad.addToolResult(toolName, toolArgs, result, llmSummary);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: 'tool_error', tool: toolName, error: errorMessage };

      // Add error to scratchpad
      const toolDescription = getToolDescription(toolName, toolArgs);
      const errorSummary = `- ${toolDescription} [FAILED]: ${errorMessage}`;
      scratchpad.addToolResult(toolName, toolArgs, `Error: ${errorMessage}`, errorSummary);
    }
  }

  /**
   * Build initial prompt with conversation history context if available
   */
  private buildInitialPrompt(
    query: string,
    inMemoryChatHistory?: InMemoryChatHistory
  ): string {
    if (!inMemoryChatHistory?.hasMessages()) {
      return query;
    }

    const userMessages = inMemoryChatHistory.getUserMessages();
    if (userMessages.length === 0) {
      return query;
    }

    const historyContext = userMessages.map((msg, i) => `${i + 1}. ${msg}`).join('\n');
    return `Current query to answer: ${query}\n\nPrevious user queries for context:\n${historyContext}`;
  }

  /**
   * Build full context data for final answer generation from scratchpad
   */
  private buildFullContextForAnswer(scratchpad: Scratchpad): string {
    const contexts = scratchpad.getFullContexts();

    if (contexts.length === 0) {
      return 'No data was gathered.';
    }

    const validContexts = contexts.filter(ctx => !ctx.result.startsWith('Error:'));

    if (validContexts.length === 0) {
      return 'No data was successfully gathered.';
    }

    return validContexts.map(ctx => {
      const description = getToolDescription(ctx.toolName, ctx.args);
      try {
        return `### ${description}\n\`\`\`json\n${JSON.stringify(JSON.parse(ctx.result), null, 2)}\n\`\`\``;
      } catch {
        return `### ${description}\n${ctx.result}`;
      }
    }).join('\n\n');
  }
}
