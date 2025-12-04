import { COLORS, logger, requireEnv } from "./common";
import { getConfig } from "./config";
import { DEFAULT_MODEL_TIERS, type ModelTiers } from "@/schemas/config";

// --- OpenRouter Configuration ---

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Model Tiers - Choose based on task complexity and importance
 *
 * MAX: Most capable, highest cost - Use for critical/complex tasks
 * - Security audits, deep code analysis, complex pattern detection
 *
 * MEDIUM: Balanced performance - Use for standard tasks
 * - Commit messages, type fixing, general analysis
 *
 * SMALL: Fast and cheap - Use for simple/repetitive tasks
 * - Simple formatting, basic checks, high-volume operations
 *
 * Models are configurable via sg.config.ts or ~/.config/sg/config.ts
 */
export type ModelTier = "MAX" | "MEDIUM" | "SMALL";

/**
 * Get configured model tiers from config or defaults
 */
const getModelTiers = (): ModelTiers => {
  const config = getConfig();
  return config.ai.modelTiers ?? DEFAULT_MODEL_TIERS;
};

/**
 * Get the default model from config
 */
export const getDefaultModel = (): string => {
  const config = getConfig();
  return config.ai.model;
};

// --- Types ---

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenRouterMessageContent[];
}

export interface OpenRouterMessageContent {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface OpenRouterOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  scriptName?: string;
  includeUsage?: boolean;
  responseFormat?: { type: "json_object" };
}

export interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    cache_discount?: number;
    cache_read_input_tokens?: number;
    total_tokens: number;
  };
}

// --- API Client ---

export const callOpenRouter = async (
  messages: OpenRouterMessage[],
  options: OpenRouterOptions = {}
): Promise<OpenRouterResponse> => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "Get your API key from https://openrouter.ai/keys");

  const {
    model = process.env.OPENROUTER_MODEL || getDefaultModel(),
    temperature = 0.3,
    max_tokens = 500,
    scriptName = "sg CLI",
    includeUsage = true,
    responseFormat,
  } = options;

  try {
    const requestBody: any = {
      model,
      messages,
      temperature,
      max_tokens,
      usage: { include: includeUsage },
    };

    if (responseFormat) {
      requestBody.response_format = responseFormat;
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://qwick.com",
        "X-Title": scriptName,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterResponse;

    // @ts-ignore - OpenRouter error format
    if (data.error) {
      // @ts-ignore
      throw new Error(`API Error: ${data.error.message}`);
    }

    return data;
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`OpenRouter API call failed: ${e.message}`);
    }
    throw e;
  }
};

// --- Helper Functions ---

/**
 * Create a message with cache control for prompt caching
 */
export const createCachedMessage = (text: string, role: "user" | "system" = "user"): OpenRouterMessage => {
  return {
    role,
    content: [
      {
        type: "text",
        text,
        cache_control: { type: "ephemeral" },
      },
    ],
  };
};

/**
 * Create a simple text message
 */
export const createMessage = (text: string, role: "user" | "system" | "assistant" = "user"): OpenRouterMessage => {
  return {
    role,
    content: text,
  };
};

/**
 * Create a user message with multiple parts (some cached, some not)
 */
export const createMultiPartMessage = (parts: Array<{ text: string; cached?: boolean }>): OpenRouterMessage => {
  const content: OpenRouterMessageContent[] = parts.map((part) => ({
    type: "text",
    text: part.text,
    ...(part.cached ? { cache_control: { type: "ephemeral" } } : {}),
  }));

  return {
    role: "user",
    content,
  };
};

/**
 * Extract content from OpenRouter response
 */
export const extractContent = (response: OpenRouterResponse): string => {
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content in response");
  }
  return content;
};

/**
 * Print token usage statistics
 */
export const printUsageStats = (response: OpenRouterResponse): void => {
  if (!response.usage) return;

  const { prompt_tokens, completion_tokens, cache_discount, cache_read_input_tokens } = response.usage;
  const cached = cache_discount || cache_read_input_tokens || 0;

  console.log(`${COLORS.green}📊 Token Usage:${COLORS.reset}`);
  console.log(`   Prompt tokens: ${prompt_tokens}`);
  console.log(`   Completion tokens: ${completion_tokens}`);
  if (cached > 0) {
    console.log(`   ${COLORS.green}💰 Cache hit: ${cached} tokens saved!${COLORS.reset}`);
  }
};

/**
 * Get the configured model for a given complexity level
 *
 * Priority:
 * 1. OPENROUTER_MODEL env var (global override for testing)
 * 2. Complexity-specific override (e.g., SG_MODEL_MAX=custom-model)
 * 3. Model from config file (sg.config.ts or ~/.config/sg/config.ts)
 * 4. Default model for the complexity tier
 *
 * @param complexity - Task complexity: MAX (critical/complex), MEDIUM (standard), SMALL (simple/repetitive)
 * @returns Model identifier to use for OpenRouter API
 *
 * @example
 * // Security audit - needs most capable model
 * const model = getModelForComplexity("MAX");
 *
 * // Commit message - standard complexity
 * const model = getModelForComplexity("MEDIUM");
 *
 * // Simple checks - use cheapest model
 * const model = getModelForComplexity("SMALL");
 */
export const getModelForComplexity = (complexity: ModelTier): string => {
  // 1. Global override (allows testing with specific models)
  if (process.env.OPENROUTER_MODEL) {
    return process.env.OPENROUTER_MODEL;
  }

  // 2. Complexity-specific override from env (e.g., SG_MODEL_MAX=custom-model)
  const envVarName = `SG_MODEL_${complexity}`;
  const customModel = process.env[envVarName];

  if (customModel) {
    return customModel;
  }

  // 3. Get model from config (with defaults)
  const tiers = getModelTiers();
  const tierKey = complexity.toLowerCase() as keyof ModelTiers;
  return tiers[tierKey];
};
