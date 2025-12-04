/**
 * Utility functions for token tracking calculations
 */

import {
  getActualPricing,
  getComparisonPricing,
  getDeveloperHourlyRate,
  getTimeEstimates,
} from "./config.ts";
import type { PricingModel } from "@/schemas/config.ts";
import type { Session, TimeSavings, UsageStats } from "./types.ts";

export const formatNumber = (num: number): string => new Intl.NumberFormat().format(num);

export const formatCurrency = (num: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
  }).format(num);

/**
 * Map script names to time estimate keys
 */
const getTimeEstimateKey = (scriptName: string): string => {
  const mapping: Record<string, string> = {
    "git-commit": "gitCommit",
    "git_commit": "gitCommit",
    "gitcommit": "gitCommit",
    "git-squash": "gitSquash",
    "git_squash": "gitSquash",
    "gitsquash": "gitSquash",
    "ts-fix": "tsFix",
    "ts_fix": "tsFix",
    "tsfix": "tsFix",
    "audit-code": "auditCode",
    "audit_code": "auditCode",
    "auditcode": "auditCode",
    "audit-deps": "auditDeps",
    "audit_deps": "auditDeps",
    "auditdeps": "auditDeps",
    "audit-patterns": "auditPatterns",
    "audit_patterns": "auditPatterns",
    "auditpatterns": "auditPatterns",
  };

  const normalized = scriptName.toLowerCase().replace(/-/g, "_");
  return mapping[normalized] || "default";
};

/**
 * Options for calculating time savings with custom pricing
 */
export interface CalculateTimeSavingsOptions {
  actualPricing?: PricingModel;
  comparisonPricing?: PricingModel;
  hourlyRate?: number;
}

/**
 * Calculate time savings and ROI based on actual token usage
 * Compares actual pricing (what we use) vs comparison pricing (alternative)
 *
 * @param stats - Usage statistics
 * @param sessions - Session data
 * @param options - Optional custom pricing (for fetched API prices)
 */
export const calculateTimeSavings = (
  stats: UsageStats,
  sessions: Session[],
  options: CalculateTimeSavingsOptions = {}
): TimeSavings => {
  const actualPricing = options.actualPricing ?? getActualPricing();
  const comparisonPricing = options.comparisonPricing ?? getComparisonPricing();
  const timeEstimates = getTimeEstimates();
  const hourlyRate = options.hourlyRate ?? getDeveloperHourlyRate();

  let alternativeCost = 0;
  let cacheSavings = 0;
  let totalMinutesSaved = 0;

  // Calculate what we'd pay with the comparison model
  for (const session of sessions) {
    const promptTokens = session.usage.prompt_tokens;
    const completionTokens = session.usage.completion_tokens;
    const cachedTokens = session.usage.cached_tokens;

    // Cost with comparison model (e.g., Claude Code)
    const comparisonPromptCost = (promptTokens * comparisonPricing.inputPerMillion) / 1_000_000;
    const comparisonCompletionCost = (completionTokens * comparisonPricing.outputPerMillion) / 1_000_000;
    alternativeCost += comparisonPromptCost + comparisonCompletionCost;

    // Cache savings (what we saved by using cached tokens)
    // Cached tokens are charged at discounted rate
    const fullCachedCost = (cachedTokens * actualPricing.inputPerMillion) / 1_000_000;
    cacheSavings += fullCachedCost * actualPricing.cacheDiscount;

    // Time saved based on script type
    const estimateKey = getTimeEstimateKey(session.script);
    const minutesSaved = timeEstimates[estimateKey as keyof typeof timeEstimates] ?? timeEstimates.default;
    totalMinutesSaved += minutesSaved;
  }

  const actualCost = stats.total_cost;
  const totalSavings = alternativeCost - actualCost;
  const valueGenerated = (totalMinutesSaved / 60) * hourlyRate;
  const roiMultiplier = actualCost > 0 ? valueGenerated / actualCost : Infinity;

  return {
    alternative_cost: alternativeCost,
    actual_cost: actualCost,
    cache_savings: cacheSavings,
    total_savings: totalSavings,
    time_saved_minutes: totalMinutesSaved,
    value_generated: valueGenerated,
    roi_multiplier: roiMultiplier,
  };
};

/**
 * Format time duration in a human-readable way
 */
export const formatDuration = (minutes: number): string => {
  if (minutes < 60) {
    return `${Math.round(minutes)} minutes`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  if (remainingMinutes === 0) {
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  }
  return `${hours}h ${remainingMinutes}m`;
};

/**
 * Get estimated time saved for a specific script
 */
export const getScriptTimeSaved = (scriptName: string): number => {
  const timeEstimates = getTimeEstimates();
  const key = getTimeEstimateKey(scriptName);
  return timeEstimates[key as keyof typeof timeEstimates] ?? timeEstimates.default;
};
