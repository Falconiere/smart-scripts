/**
 * Schema exports for sg CLI
 *
 * Re-exports all Zod schemas and types for validation
 */

// Config schemas
export {
  SgConfigSchema,
  PartialSgConfigSchema,
  GitConfigSchema,
  AiConfigSchema,
  OutputConfigSchema,
  ModelTiersSchema,
  PricingModelSchema,
  TimeEstimatesSchema,
  TrackingConfigSchema,
  DEFAULT_CONFIG,
  DEFAULT_MODEL_TIERS,
  DEFAULT_TIME_ESTIMATES,
  DEFAULT_TRACKING_CONFIG,
  validateConfig,
  validatePartialConfig,
  safeValidateConfig,
  safeValidatePartialConfig,
} from "./config.ts";

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
} from "./config.ts";

// CLI argument schemas
export {
  GlobalOptionsSchema,
  InitArgsSchema,
  CommitArgsSchema,
  PushArgsSchema,
  SquashArgsSchema,
  RebaseArgsSchema,
  TokenArgsSchema,
  StageModeSchema,
  TokenSubcommandSchema,
  validateInitArgs,
  validateCommitArgs,
  validatePushArgs,
  validateSquashArgs,
  validateRebaseArgs,
  validateTokenArgs,
} from "./cli.ts";

export type {
  GlobalOptions,
  InitArgs,
  CommitArgs,
  PushArgs,
  SquashArgs,
  RebaseArgs,
  TokenArgs,
  StageMode,
  TokenSubcommand,
} from "./cli.ts";
