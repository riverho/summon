import { AIMessage } from '@langchain/core/messages';
import { StructuredToolInterface } from '@langchain/core/tools';
import { callLlm, getFastModel } from '../runtime/llm.js';
import { Session } from '../runtime/session.js';
import { InMemoryChatHistory } from '../runtime/memory.js';
import { ComposedAgentSpec } from './composer.js';
import { GuardrailValidator } from '../guardrails/validator.js';
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
// Retry Helper
// ============================================================================

interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.baseDelay ?? 1000;
  const maxDelay = options.maxDelay ?? 10000;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxAttempts) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
        console.error(`[Retry] Tool failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
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
  private lastEvent: AgentEvent | null = null;

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
   * Get the last event (for chat history persistence)
   */
  getLastEvent(): AgentEvent | null {
    return this.lastEvent;
  }

  /**
   * Run the agent and yield events for real-time UI updates
   */
  async *run(query: string, inMemoryHistory?: InMemoryChatHistory, sessionId?: string): AsyncGenerator<AgentEvent> {
    const session = new Session(query, { sessionId });
    let currentPrompt = this.buildInitialPrompt(query, inMemoryHistory);
    let iteration = 0;

    while (iteration < this.spec.maxIterations) {
      iteration++;

      const response = await this.callModel(currentPrompt) as AIMessage;
      const responseText = extractTextContent(response);

      // Emit thinking if there are also tool calls
      if (responseText && hasToolCalls(response)) {
        session.addThinking(responseText);
        const event = { type: 'thinking' as const, message: responseText };
        this.lastEvent = event;
        yield event;
      }

      // No tool calls = ready to generate final answer
      if (!hasToolCalls(response)) {
        // If no tools were called at all, validate and return direct response
        if (!session.hasToolResults() && responseText) {
          const event = { type: 'answer_start' as const };
          this.lastEvent = event;
          yield event;

          // Run guardrails validation if configured
          let finalAnswer = responseText;
          if (this.spec.outputGuardrails && this.spec.outputGuardrails.length > 0) {
            const validator = new GuardrailValidator();
            validator.addGuardrails(this.spec.outputGuardrails);

            let result = await validator.validate(finalAnswer);
            let attempts = 1;

            // Retry loop for guardrail failures
            while (!result.success && attempts < 3) {
              yield {
                type: 'guardrail_check' as const,
                passed: false,
                attemptCount: attempts,
                errors: result.errors.map(e => `[${e.guardrailId}] ${e.message}`),
              };

              await sleep(1000 * Math.pow(2, attempts - 1));

              const errorContext = result.errors.map(e => `[${e.guardrailId}] ${e.message}`).join('\n');
              const retryPrompt = `${currentPrompt}\n\n=== VALIDATION ERRORS ===\nThe previous response failed validation:\n${errorContext}\n\nPlease fix these issues and provide a corrected response.`;

              const retryResponse = await this.callModel(retryPrompt, false);
              finalAnswer = typeof retryResponse === 'string' ? retryResponse : extractTextContent(retryResponse);

              attempts++;
              result = await validator.validate(finalAnswer);
            }

            yield {
              type: 'guardrail_check' as const,
              passed: result.success,
              attemptCount: attempts,
              errors: result.errors.map(e => `[${e.guardrailId}] ${e.message}`),
            };

            if (!result.success) {
              const blockingErrors = result.errors.filter(e => e.blocking);
              if (blockingErrors.length > 0) {
                yield {
                  type: 'guardrail_failed' as const,
                  answer: finalAnswer,
                  errors: blockingErrors.map(e => `[${e.guardrailId}] ${e.message}`),
                };
                finalAnswer = `[GUARDRAIL FAILED] ${blockingErrors.map(e => e.message).join('; ')}`;
              }
            }
          }

          const prefixedAnswer = `[${this.spec.name}] ${finalAnswer}`;
          const doneEvent = { type: 'done' as const, answer: prefixedAnswer, toolCalls: [], iterations: iteration, guardrailFailed: finalAnswer.startsWith('[GUARDRAIL FAILED]') };
          this.lastEvent = doneEvent;
          yield doneEvent;
          return;
        }

        // Generate final answer with full context from session
        const fullContext = this.buildFullContextForAnswer(session);
        const qualityChecklist = this.spec.guardrails?.thinking.qualityChecklist ?? [];
        const finalPrompt = buildFinalAnswerPrompt(query, fullContext, qualityChecklist);

        const answerStartEvent = { type: 'answer_start' as const };
        this.lastEvent = answerStartEvent;
        yield answerStartEvent;

        const finalResponse = await this.callModel(finalPrompt, false);
        let answer = typeof finalResponse === 'string'
          ? finalResponse
          : extractTextContent(finalResponse);

        // Run guardrails validation if configured
        if (this.spec.outputGuardrails && this.spec.outputGuardrails.length > 0) {
          const validator = new GuardrailValidator();
          validator.addGuardrails(this.spec.outputGuardrails);

          let result = await validator.validate(answer);
          let attempts = 1;

          // Retry loop for guardrail failures
          while (!result.success && attempts < 3) {
            // Emit check event for monitoring
            yield {
              type: 'guardrail_check',
              passed: false,
              attemptCount: attempts,
              errors: result.errors.map(e => `[${e.guardrailId}] ${e.message}`),
            };

            // Wait before retry
            const backoffDelay = 1000 * Math.pow(2, attempts - 1);
            await sleep(backoffDelay);

            // Build retry prompt with error context
            const errorContext = result.errors.map(e => `[${e.guardrailId}] ${e.message}`).join('\n');
            const retryPrompt = `${finalPrompt}\n\n=== VALIDATION ERRORS ===\nThe previous response failed validation:\n${errorContext}\n\nPlease fix these issues and provide a corrected response.`;

            const retryResponse = await this.callModel(retryPrompt, false);
            answer = typeof retryResponse === 'string'
              ? retryResponse
              : extractTextContent(retryResponse);

            attempts++;
            result = await validator.validate(answer);
          }

          // Emit final check result
          yield {
            type: 'guardrail_check',
            passed: result.success,
            attemptCount: attempts,
            errors: result.errors.map(e => `[${e.guardrailId}] ${e.message}`),
          };

          // Handle persistent failures
          if (!result.success) {
            const blockingErrors = result.errors.filter(e => e.blocking);
            if (blockingErrors.length > 0) {
              yield {
                type: 'guardrail_failed',
                answer,
                errors: blockingErrors.map(e => `[${e.guardrailId}] ${e.message}`),
              };

              const doneEvent = {
                type: 'done' as const,
                answer: `[${this.spec.name}] [GUARDRAIL FAILED] ${blockingErrors.map(e => e.message).join('; ')}`,
                toolCalls: session.getToolCallRecords(),
                iterations: iteration,
                guardrailFailed: true,
              };
              this.lastEvent = doneEvent;
              yield doneEvent;
              return;
            }
          }
        }

        const prefixedAnswer = `[${this.spec.name}] ${answer}`;
        const doneEvent = {
          type: 'done' as const,
          answer: prefixedAnswer,
          toolCalls: session.getToolCallRecords(),
          iterations: iteration,
        };
        this.lastEvent = doneEvent;
        yield doneEvent;
        return;
      }

      // Execute tools and add results to session
      const generator = this.executeToolCalls(response, query, session);
      let result = await generator.next();

      while (!result.done) {
        this.lastEvent = result.value;
        yield result.value;
        result = await generator.next();
      }

      // Build iteration prompt from session
      const qualityPrompts = this.spec.workflow?.thinking.qualityPrompts ?? [];
      currentPrompt = buildIterationPrompt(query, session.getToolSummaries(), qualityPrompts);
    }

    // Max iterations reached - still generate proper final answer
    const fullContext = this.buildFullContextForAnswer(session);
    const qualityChecklist = this.spec.guardrails?.thinking.qualityChecklist ?? [];
    const finalPrompt = buildFinalAnswerPrompt(query, fullContext, qualityChecklist);

    const answerStartEvent = { type: 'answer_start' as const };
    this.lastEvent = answerStartEvent;
    yield answerStartEvent;

    const finalResponse = await this.callModel(finalPrompt, false);
    const answer = typeof finalResponse === 'string'
      ? finalResponse
      : extractTextContent(finalResponse);

    const prefixedAnswer = `[${this.spec.name}] ${answer || `Reached maximum iterations (${this.spec.maxIterations}).`}`;
    const doneEvent = {
      type: 'done' as const,
      answer: prefixedAnswer,
      toolCalls: session.getToolCallRecords(),
      iterations: iteration,
    };
    this.lastEvent = doneEvent;
    yield doneEvent;
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
    session: Session
  ): AsyncGenerator<ToolStartEvent | ToolEndEvent | ToolErrorEvent, void> {
    for (const toolCall of response.tool_calls ?? []) {
      const toolName = toolCall.name;
      const toolArgs = toolCall.args as Record<string, unknown>;

      const generator = this.executeToolCall(toolName, toolArgs, query, session);
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
    session: Session
  ): AsyncGenerator<ToolStartEvent | ToolEndEvent | ToolErrorEvent, void> {
    yield { type: 'tool_start', tool: toolName, args: toolArgs };

    const startTime = Date.now();

    try {
      const tool = this.spec.toolMap.get(toolName);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      // Use retry mechanism for tool execution
      const rawResult = await withRetry(
        () => tool.invoke(toolArgs, this.signal ? { signal: this.signal } : undefined),
        { maxAttempts: 3, baseDelay: 1000, maxDelay: 5000 }
      );
      
      const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      const duration = Date.now() - startTime;

      yield { type: 'tool_end', tool: toolName, args: toolArgs, result, duration };

      // Generate LLM summary for context compaction
      const llmSummary = await this.summarizeToolResult(query, toolName, toolArgs, result);

      // Add complete tool result to session
      session.addToolResult(toolName, toolArgs, result, llmSummary);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: 'tool_error', tool: toolName, error: errorMessage };

      // Add error to session
      const toolDescription = getToolDescription(toolName, toolArgs);
      const errorSummary = `- ${toolDescription} [FAILED]: ${errorMessage}`;
      session.addToolResult(toolName, toolArgs, `Error: ${errorMessage}`, errorSummary);
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
   * Build full context data for final answer generation from session
   */
  private buildFullContextForAnswer(session: Session): string {
    const contexts = session.getFullContexts();

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
