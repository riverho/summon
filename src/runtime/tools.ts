import { StructuredToolInterface } from '@langchain/core/tools';

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
