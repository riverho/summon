import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { StructuredToolInterface } from '@langchain/core/tools';
import { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';

// Provider priority order (first match wins)
const PROVIDER_PRIORITY = ['openrouter', 'openai', 'anthropic', 'google', 'xai', 'ollama'];

// Default exports for backwards compatibility
export const DEFAULT_PROVIDER = 'openrouter';
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// Default models by provider
const DEFAULT_MODELS: Record<string, string> = {
  openrouter: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  google: 'gemini-2.0-flash',
  xai: 'grok-2',
  ollama: 'llama3.2',
};

// Fast model variants for lightweight tasks
const FAST_MODELS: Record<string, string> = {
  openrouter: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-haiku-20240307',
  google: 'gemini-2.0-flash',
  xai: 'grok-2-mini',
  ollama: 'llama3.2',
};

/**
 * Detect which provider to use based on env vars
 */
function detectProvider(): string {
  // Check for explicit override
  const explicitProvider = process.env.DEFAULT_LLM_PROVIDER;
  if (explicitProvider && PROVIDER_PRIORITY.includes(explicitProvider)) {
    return explicitProvider;
  }

  // Check in priority order
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GOOGLE_API_KEY) return 'google';
  if (process.env.XAI_API_KEY) return 'xai';
  if (process.env.OLLAMA_BASE_URL) return 'ollama';

  throw new Error('No LLM provider configured. Set OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, XAI_API_KEY, or OLLAMA_BASE_URL');
}

/**
 * Get the model name for a provider
 */
function getModelForProvider(provider: string, requestedModel?: string): string {
  if (requestedModel) return requestedModel;
  
  // Check for provider-specific model env var
  const modelEnvVar = `${provider.toUpperCase()}_MODEL`;
  const envModel = process.env[modelEnvVar];
  if (envModel) return envModel;
  
  return DEFAULT_MODELS[provider] || 'gpt-4o-mini';
}

/**
 * Gets the fast model variant for the given provider.
 */
export function getFastModel(modelProvider: string, fallbackModel: string): string {
  return FAST_MODELS[modelProvider] ?? fallbackModel;
}

// Generic retry helper with exponential backoff
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === maxAttempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error('Unreachable');
}

// Model provider configuration
interface ModelOpts {
  streaming: boolean;
}

type ModelFactory = (name: string, opts: ModelOpts) => BaseChatModel;

function getApiKey(envVar: string, providerName: string): string {
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`${envVar} not found in environment variables`);
  }
  return apiKey;
}

// Provider factories
const PROVIDER_FACTORIES: Record<string, ModelFactory> = {
  openrouter: (name, opts) => new ChatOpenAI({
    model: name,
    ...opts,
    apiKey: getApiKey('OPENROUTER_API_KEY', 'OpenRouter'),
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://summon.ai',
        'X-Title': process.env.OPENROUTER_X_TITLE || 'Summon',
      },
    },
  }),
  
  openai: (name, opts) => new ChatOpenAI({
    model: name,
    ...opts,
    apiKey: getApiKey('OPENAI_API_KEY', 'OpenAI'),
    ...(process.env.OPENAI_BASE_URL ? {
      configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
        ...(process.env.OPENAI_HTTP_REFERER ? {
          defaultHeaders: {
            'HTTP-Referer': process.env.OPENAI_HTTP_REFERER,
            ...(process.env.OPENAI_X_TITLE ? { 'X-Title': process.env.OPENAI_X_TITLE } : {}),
          },
        } : {}),
      },
    } : {}),
  }),
  
  anthropic: (name, opts) => new ChatAnthropic({
    model: name,
    ...opts,
    apiKey: getApiKey('ANTHROPIC_API_KEY', 'Anthropic'),
    ...(process.env.ANTHROPIC_BASE_URL ? {
      clientOptions: { baseURL: process.env.ANTHROPIC_BASE_URL },
    } : {}),
  }),
  
  google: (name, opts) => new ChatGoogleGenerativeAI({
    model: name,
    ...opts,
    apiKey: getApiKey('GOOGLE_API_KEY', 'Google'),
  }),
  
  xai: (name, opts) => new ChatOpenAI({
    model: name,
    ...opts,
    apiKey: getApiKey('XAI_API_KEY', 'xAI'),
    configuration: {
      baseURL: 'https://api.x.ai/v1',
    },
  }),
  
  ollama: (name, opts) => new ChatOllama({
    model: name,
    ...opts,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  }),
};

// Backwards compatibility: model name prefixes for explicit routing
const MODEL_PREFIXES: Record<string, string> = {
  'claude-': 'anthropic',
  'gemini-': 'google',
  'grok-': 'xai',
  'ollama:': 'ollama',
  // OpenRouter prefixes
  'openai/': 'openrouter',
  'anthropic/': 'openrouter',
  'google/': 'openrouter',
  'x-ai/': 'openrouter',
  'z-ai/': 'openrouter',
};

/**
 * Get the appropriate chat model
 */
export function getChatModel(
  modelName?: string,
  streaming: boolean = false
): BaseChatModel {
  const opts: ModelOpts = { streaming };
  
  // Check for explicit provider override via model prefix
  if (modelName) {
    for (const [prefix, provider] of Object.entries(MODEL_PREFIXES)) {
      if (modelName.startsWith(prefix)) {
        const factory = PROVIDER_FACTORIES[provider];
        return factory(modelName, opts);
      }
    }
  }
  
  // Auto-detect provider from env
  const provider = detectProvider();
  const model = getModelForProvider(provider, modelName);
  const factory = PROVIDER_FACTORIES[provider];
  
  return factory(model, opts);
}

interface CallLlmOptions {
  model?: string;
  systemPrompt?: string;
  outputSchema?: z.ZodType<unknown>;
  tools?: StructuredToolInterface[];
  signal?: AbortSignal;
}

export async function callLlm(prompt: string, options: CallLlmOptions = {}): Promise<unknown> {
  const { model: requestedModel, systemPrompt = '', outputSchema, tools, signal } = options;

  // Detect provider and get model
  const provider = detectProvider();
  const model = getModelForProvider(provider, requestedModel);

  const finalSystemPrompt = escapeTemplateBraces(systemPrompt);

  const promptTemplate = ChatPromptTemplate.fromMessages([
    ['system', finalSystemPrompt],
    ['user', '{prompt}'],
  ]);

  const llm = getChatModel(model, false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runnable: Runnable<any, any> = llm;

  if (outputSchema) {
    runnable = llm.withStructuredOutput(outputSchema, { strict: false });
  } else if (tools && tools.length > 0 && llm.bindTools) {
    runnable = llm.bindTools(tools);
  }

  const chain = promptTemplate.pipe(runnable);

  const result = await withRetry(() => chain.invoke({ prompt }, signal ? { signal } : undefined));

  // If no outputSchema and no tools, extract content from AIMessage
  // When tools are provided, return the full AIMessage to preserve tool_calls
  if (!outputSchema && !tools && result && typeof result === 'object' && 'content' in result) {
    return (result as { content: string }).content;
  }
  return result;
}

function escapeTemplateBraces(text: string): string {
  return text.replace(/[{}]/g, (match) => (match === '{' ? '{{' : '}}'));
}
