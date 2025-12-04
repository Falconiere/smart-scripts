/**
 * Token tracking types
 */

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  effective_tokens: number;
}

export interface Session {
  script: string;
  timestamp: string;
  model: string;
  usage: TokenUsage;
  cost_usd: string;
}

export interface UsageData {
  version: string;
  sessions: Session[];
}

export interface UsageStats {
  total_sessions: number;
  total_tokens: number;
  effective_tokens: number;
  cached_tokens: number;
  total_cost: number;
  by_script: Array<{
    script: string;
    sessions: number;
    total_tokens: number;
    cached_tokens: number;
    cost: number;
  }>;
}

// Re-export PricingModel from schemas for backward compatibility
export type { PricingModel } from "@/schemas/config.ts";

export interface TimeSavings {
  alternative_cost: number; // What we'd pay with comparison model
  actual_cost: number; // What we paid with actual model
  cache_savings: number; // Savings from cache hits
  total_savings: number; // Total financial savings
  time_saved_minutes: number; // Estimated time saved
  value_generated: number; // Estimated value of time saved
  roi_multiplier: number; // ROI = value_generated / actual_cost
}
