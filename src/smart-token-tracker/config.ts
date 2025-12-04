/**
 * Token tracker configuration
 *
 * All configuration is now centralized in src/schemas/config.ts
 * This module provides convenience accessors for the token tracker.
 *
 * Pricing can be fetched from OpenRouter API for accurate values.
 */

import { join } from "node:path";
import { getProjectRoot } from "@/utils/common.ts";
import { getConfig, getTrackingConfig } from "@/utils/config.ts";
import type { PricingModel, TimeEstimates, TrackingConfig } from "@/schemas/config.ts";
import { DEFAULT_TIME_ESTIMATES, DEFAULT_TRACKING_CONFIG } from "@/schemas/config.ts";
import { getModelPricing } from "@/utils/openrouter-pricing.ts";

/**
 * Get the token usage file path
 */
export const getTokenUsageFile = (): string => {
  const trackingConfig = getTrackingConfig();
  const file = process.env.TOKEN_USAGE_FILE || trackingConfig.usageFile;
  return join(getProjectRoot(), file);
};

/**
 * Check if tracking is enabled
 */
export const isTrackingEnabled = (): boolean => {
  if (process.env.TRACKING_ENABLED === "false") return false;
  const trackingConfig = getTrackingConfig();
  return trackingConfig.enabled;
};

/**
 * Get pricing configuration for the actual model being used
 */
export const getActualPricing = (): PricingModel => {
  const trackingConfig = getTrackingConfig();
  return trackingConfig.actualPricing;
};

/**
 * Get pricing configuration for the comparison model
 */
export const getComparisonPricing = (): PricingModel => {
  const trackingConfig = getTrackingConfig();
  return trackingConfig.comparisonPricing;
};

/**
 * Get time estimates for different script types
 */
export const getTimeEstimates = (): TimeEstimates => {
  const trackingConfig = getTrackingConfig();
  return trackingConfig.timeEstimates ?? DEFAULT_TIME_ESTIMATES;
};

/**
 * Get developer hourly rate for ROI calculation
 */
export const getDeveloperHourlyRate = (): number => {
  const trackingConfig = getTrackingConfig();
  return trackingConfig.developerHourlyRate;
};

/**
 * Get the full tracking configuration
 */
export const getFullTrackingConfig = (): TrackingConfig => {
  return getTrackingConfig();
};

/**
 * Fetch real pricing from OpenRouter API for the actual model
 * Falls back to config values if fetch fails
 */
export const fetchActualPricing = async (): Promise<PricingModel> => {
  const config = getConfig();
  const modelId = config.ai.model;

  try {
    const pricing = await getModelPricing(modelId);
    if (pricing) {
      return pricing;
    }
  } catch {
    // Fall back to config
  }

  return getActualPricing();
};

/**
 * Fetch real pricing from OpenRouter API for a comparison model
 * Uses the MAX tier model as comparison by default
 * Falls back to config values if fetch fails
 */
export const fetchComparisonPricing = async (): Promise<PricingModel> => {
  const config = getConfig();
  const modelTiers = config.ai.modelTiers;

  // Use MAX tier as comparison (typically the most expensive/capable)
  const comparisonModelId = modelTiers?.max ?? "anthropic/claude-sonnet-4-5";

  try {
    const pricing = await getModelPricing(comparisonModelId);
    if (pricing) {
      return pricing;
    }
  } catch {
    // Fall back to config
  }

  return getComparisonPricing();
};

/**
 * Fetch pricing for a specific model ID from OpenRouter API
 * Falls back to a default pricing model if fetch fails
 */
export const fetchPricingForModel = async (modelId: string): Promise<PricingModel> => {
  try {
    const pricing = await getModelPricing(modelId);
    if (pricing) {
      return pricing;
    }
  } catch {
    // Fall back to default
  }

  return {
    name: modelId,
    inputPerMillion: 1.0,
    outputPerMillion: 5.0,
    cacheDiscount: 0.9,
  };
};

// Re-export defaults for backward compatibility
export { DEFAULT_TIME_ESTIMATES, DEFAULT_TRACKING_CONFIG };

// Legacy exports - deprecated, use getActualPricing() and getComparisonPricing() instead
/** @deprecated Use getActualPricing() and getComparisonPricing() instead */
export const PRICING = {
  get HAIKU() {
    const pricing = getActualPricing();
    return {
      name: pricing.name,
      input_per_million: pricing.inputPerMillion,
      output_per_million: pricing.outputPerMillion,
      cache_discount: pricing.cacheDiscount,
    };
  },
  get SONNET() {
    const pricing = getComparisonPricing();
    return {
      name: pricing.name,
      input_per_million: pricing.inputPerMillion,
      output_per_million: pricing.outputPerMillion,
      cache_discount: pricing.cacheDiscount,
    };
  },
};

/** @deprecated Use getTimeEstimates() instead */
export const TIME_ESTIMATES = {
  get GIT_COMMIT() { return getTimeEstimates().gitCommit; },
  get GIT_SQUASH() { return getTimeEstimates().gitSquash; },
  get TS_FIX() { return getTimeEstimates().tsFix; },
  get AUDIT_CODE() { return getTimeEstimates().auditCode; },
  get AUDIT_DEPS() { return getTimeEstimates().auditDeps; },
  get AUDIT_PATTERNS() { return getTimeEstimates().auditPatterns; },
  get DEFAULT() { return getTimeEstimates().default; },
};

/** @deprecated Use getDeveloperHourlyRate() instead */
export const DEVELOPER_HOURLY_RATE = 100;
