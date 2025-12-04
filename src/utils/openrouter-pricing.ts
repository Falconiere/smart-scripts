/**
 * OpenRouter Pricing API
 *
 * Fetches real-time model pricing from OpenRouter's API
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectRoot } from "@/utils/common.ts";
import type { PricingModel } from "@/schemas/config.ts";

const OPENROUTER_MODELS_API = "https://openrouter.ai/api/v1/models";
const CACHE_FILE = ".cache/openrouter-models.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface OpenRouterModelPricing {
  prompt: string;
  completion: string;
  request?: string;
  image?: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: OpenRouterModelPricing;
  context_length: number;
  top_provider?: {
    max_completion_tokens?: number;
  };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

interface CachedModels {
  timestamp: number;
  models: OpenRouterModel[];
}

/**
 * Get the cache file path
 */
const getCacheFilePath = (): string => {
  return join(getProjectRoot(), CACHE_FILE);
};

/**
 * Read cached models if available and not expired
 */
const readCache = (): OpenRouterModel[] | null => {
  const cachePath = getCacheFilePath();

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(cachePath, "utf8")) as CachedModels;
    const age = Date.now() - data.timestamp;

    if (age > CACHE_TTL_MS) {
      return null; // Cache expired
    }

    return data.models;
  } catch {
    return null;
  }
};

/**
 * Write models to cache
 */
const writeCache = (models: OpenRouterModel[]): void => {
  const cachePath = getCacheFilePath();
  const cacheDir = join(getProjectRoot(), ".cache");

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  const data: CachedModels = {
    timestamp: Date.now(),
    models,
  };

  writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
};

/**
 * Fetch all models from OpenRouter API
 */
export const fetchOpenRouterModels = async (): Promise<OpenRouterModel[]> => {
  // Check cache first
  const cached = readCache();
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(OPENROUTER_MODELS_API);

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = (await response.json()) as OpenRouterModelsResponse;
    const models = data.data;

    // Cache the results
    writeCache(models);

    return models;
  } catch (error) {
    // If fetch fails, try to use expired cache
    const cachePath = getCacheFilePath();
    if (existsSync(cachePath)) {
      const data = JSON.parse(readFileSync(cachePath, "utf8")) as CachedModels;
      return data.models;
    }
    throw error;
  }
};

/**
 * Get pricing for a specific model by ID
 */
export const getModelPricing = async (modelId: string): Promise<PricingModel | null> => {
  const models = await fetchOpenRouterModels();
  const model = models.find((m) => m.id === modelId);

  if (!model) {
    return null;
  }

  return convertToPricingModel(model);
};

/**
 * Convert OpenRouter model to PricingModel format
 */
export const convertToPricingModel = (model: OpenRouterModel): PricingModel => {
  const promptPrice = parseFloat(model.pricing.prompt) || 0;
  const completionPrice = parseFloat(model.pricing.completion) || 0;
  const cacheReadPrice = parseFloat(model.pricing.input_cache_read || "0") || 0;

  // Convert from per-token to per-million
  const inputPerMillion = promptPrice * 1_000_000;
  const outputPerMillion = completionPrice * 1_000_000;

  // Calculate cache discount (how much cheaper cached tokens are)
  // If cache read is 0.1 and prompt is 1.0, discount is 0.9 (90% off)
  let cacheDiscount = 0.9; // Default 90% discount
  if (promptPrice > 0 && cacheReadPrice > 0) {
    cacheDiscount = 1 - cacheReadPrice / promptPrice;
  }

  return {
    name: model.name,
    inputPerMillion,
    outputPerMillion,
    cacheDiscount: Math.max(0, Math.min(1, cacheDiscount)),
  };
};

/**
 * Get pricing for multiple models at once
 */
export const getMultipleModelPricing = async (
  modelIds: string[]
): Promise<Map<string, PricingModel>> => {
  const models = await fetchOpenRouterModels();
  const result = new Map<string, PricingModel>();

  for (const modelId of modelIds) {
    const model = models.find((m) => m.id === modelId);
    if (model) {
      result.set(modelId, convertToPricingModel(model));
    }
  }

  return result;
};

/**
 * Search for models by name or ID pattern
 */
export const searchModels = async (query: string): Promise<OpenRouterModel[]> => {
  const models = await fetchOpenRouterModels();
  const lowerQuery = query.toLowerCase();

  return models.filter(
    (m) => m.id.toLowerCase().includes(lowerQuery) || m.name.toLowerCase().includes(lowerQuery)
  );
};

/**
 * Get formatted pricing string for a model
 */
export const getFormattedPricing = async (modelId: string): Promise<string | null> => {
  const pricing = await getModelPricing(modelId);

  if (!pricing) {
    return null;
  }

  return `${pricing.name}: $${pricing.inputPerMillion.toFixed(2)}/M input, $${pricing.outputPerMillion.toFixed(2)}/M output`;
};

/**
 * Clear the pricing cache
 */
export const clearPricingCache = (): void => {
  const cachePath = getCacheFilePath();
  if (existsSync(cachePath)) {
    const fs = require("node:fs");
    fs.unlinkSync(cachePath);
  }
};
