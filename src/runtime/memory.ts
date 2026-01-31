import { createHash } from 'crypto';
import { callLlm, DEFAULT_MODEL } from './llm.js';
import { z } from 'zod';

/**
 * Represents a single conversation turn (query + answer + summary)
 */
export interface Message {
  id: number;
  query: string;
  answer: string | null;
  summary: string | null;
}

/**
 * Schema for LLM to select relevant messages
 */
export const SelectedMessagesSchema = z.object({
  message_ids: z.array(z.number()).describe('List of relevant message IDs (0-indexed)'),
});

const MESSAGE_SUMMARY_SYSTEM_PROMPT = `You are a concise summarizer. Generate brief summaries of conversation answers.
Keep summaries to 1-2 sentences that capture the key information.`;

const MESSAGE_SELECTION_SYSTEM_PROMPT = `You are a relevance evaluator. Select which previous conversation messages are relevant to the current query.
Return only message IDs that contain information directly useful for answering the current query.`;

/**
 * Manages in-memory conversation history for multi-turn conversations.
 */
export class InMemoryChatHistory {
  private messages: Message[] = [];
  private model: string;
  private relevantMessagesByQuery: Map<string, Message[]> = new Map();

  constructor(model: string = DEFAULT_MODEL) {
    this.model = model;
  }

  private hashQuery(query: string): string {
    return createHash('md5').update(query).digest('hex').slice(0, 12);
  }

  setModel(model: string): void {
    this.model = model;
  }

  private async generateSummary(query: string, answer: string): Promise<string> {
    const answerPreview = answer.slice(0, 1500);

    const prompt = `Query: "${query}"
Answer: "${answerPreview}"

Generate a brief 1-2 sentence summary of this answer.`;

    try {
      const response = await callLlm(prompt, {
        systemPrompt: MESSAGE_SUMMARY_SYSTEM_PROMPT,
        model: this.model,
      });
      return typeof response === 'string' ? response.trim() : String(response).trim();
    } catch {
      return `Answer to: ${query.slice(0, 100)}`;
    }
  }

  saveUserQuery(query: string): void {
    this.relevantMessagesByQuery.clear();

    this.messages.push({
      id: this.messages.length,
      query,
      answer: null,
      summary: null,
    });
  }

  async saveAnswer(answer: string): Promise<void> {
    const lastMessage = this.messages[this.messages.length - 1];
    if (!lastMessage || lastMessage.answer !== null) {
      return;
    }

    lastMessage.answer = answer;
    lastMessage.summary = await this.generateSummary(lastMessage.query, answer);
  }

  async selectRelevantMessages(currentQuery: string): Promise<Message[]> {
    const completedMessages = this.messages.filter((m) => m.answer !== null);
    if (completedMessages.length === 0) {
      return [];
    }

    const cacheKey = this.hashQuery(currentQuery);
    const cached = this.relevantMessagesByQuery.get(cacheKey);
    if (cached) {
      return cached;
    }

    const messagesInfo = completedMessages.map((message) => ({
      id: message.id,
      query: message.query,
      summary: message.summary,
    }));

    const prompt = `Current user query: "${currentQuery}"

Previous conversations:
${JSON.stringify(messagesInfo, null, 2)}

Select which previous messages are relevant to understanding or answering the current query.`;

    try {
      const response = await callLlm(prompt, {
        systemPrompt: MESSAGE_SELECTION_SYSTEM_PROMPT,
        model: this.model,
        outputSchema: SelectedMessagesSchema,
      });

      const selectedIds = (response as { message_ids: number[] }).message_ids || [];

      const selectedMessages = selectedIds
        .filter((idx) => idx >= 0 && idx < this.messages.length)
        .map((idx) => this.messages[idx])
        .filter((m) => m.answer !== null);

      this.relevantMessagesByQuery.set(cacheKey, selectedMessages);

      return selectedMessages;
    } catch {
      return [];
    }
  }

  formatForPlanning(messages: Message[]): string {
    if (messages.length === 0) {
      return '';
    }

    return messages
      .map((message) => `User: ${message.query}\nAssistant: ${message.summary}`)
      .join('\n\n');
  }

  formatForAnswerGeneration(messages: Message[]): string {
    if (messages.length === 0) {
      return '';
    }

    return messages
      .map((message) => `User: ${message.query}\nAssistant: ${message.answer}`)
      .join('\n\n');
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  getUserMessages(): string[] {
    return this.messages.map((message) => message.query);
  }

  hasMessages(): boolean {
    return this.messages.length > 0;
  }

  clear(): void {
    this.messages = [];
    this.relevantMessagesByQuery.clear();
  }
}
