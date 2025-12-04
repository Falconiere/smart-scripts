/**
 * smart-scripts - AI-powered git workflow tools
 *
 * This module exports types for use in sg.config.ts files
 */

// Export configuration types for user config files
export type {
  SgConfig,
  PartialSgConfig,
  GitConfig,
  AiConfig,
  OutputConfig,
  ModelTiers,
  PricingModel,
  TimeEstimates,
  TrackingConfig,
  CommitConfig,
} from "./schemas/config.ts";

// Export default values for reference
export {
  DEFAULT_CONFIG,
  DEFAULT_MODEL_TIERS,
  DEFAULT_TIME_ESTIMATES,
  DEFAULT_TRACKING_CONFIG,
  DEFAULT_COMMIT_CONFIG,
  DEFAULT_COMMIT_TYPES,
} from "./schemas/config.ts";
