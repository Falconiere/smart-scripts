/**
 * Zod schemas for sg CLI configuration
 *
 * These schemas provide runtime validation and type inference
 * for all configuration values.
 */

import { z } from "zod/v4";

/**
 * Git configuration schema
 */
export const GitConfigSchema = z.object({
  baseBranch: z
    .string()
    .min(1, "Base branch cannot be empty")
    .regex(/^[a-zA-Z0-9_\-/.]+$/, "Invalid branch name format"),
  requireJiraId: z.boolean().default(true),
  autoSquash: z.boolean().default(false),
  forceWithLease: z.boolean().default(true),
  /** Lint command to run on staged files before commit (set to false to disable) */
  lintStagedCmd: z.union([z.string(), z.boolean()]).default(false),
});

/**
 * Model string validation (format: provider/model-name)
 */
const ModelStringSchema = z
  .string()
  .min(1, "Model cannot be empty")
  .regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/, "Model must be in format: provider/model-name");

/**
 * Model tiers configuration schema
 * Allows configuring which models to use for different complexity levels
 */
export const ModelTiersSchema = z.object({
  max: ModelStringSchema.describe("Most capable model for complex tasks"),
  medium: ModelStringSchema.describe("Balanced model for standard tasks"),
  small: ModelStringSchema.describe("Fast/cheap model for simple tasks"),
});

/**
 * AI provider configuration schema
 */
export const AiConfigSchema = z.object({
  provider: z.literal("openrouter"),
  model: ModelStringSchema,
  modelTiers: ModelTiersSchema.optional(),
  cacheEnabled: z.boolean().default(true),
});

/**
 * Output configuration schema
 */
export const OutputConfigSchema = z.object({
  verbose: z.boolean().default(false),
  quiet: z.boolean().default(false),
  json: z.boolean().default(false),
  colors: z.boolean().default(true),
});

/**
 * Pricing model for cost calculations
 */
export const PricingModelSchema = z.object({
  name: z.string().min(1, "Model name is required"),
  inputPerMillion: z.number().positive("Input price must be positive"),
  outputPerMillion: z.number().positive("Output price must be positive"),
  cacheDiscount: z.number().min(0).max(1).default(0.9),
});

/**
 * Time estimates for different script types (in minutes)
 */
export const TimeEstimatesSchema = z.object({
  gitCommit: z.number().positive().default(5),
  gitSquash: z.number().positive().default(10),
  tsFix: z.number().positive().default(15),
  auditCode: z.number().positive().default(30),
  auditDeps: z.number().positive().default(20),
  auditPatterns: z.number().positive().default(25),
  default: z.number().positive().default(10),
});

/**
 * Token tracking configuration schema
 */
export const TrackingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  usageFile: z.string().default(".cache/token-usage.json"),
  developerHourlyRate: z.number().positive().default(100),
  /** Pricing for the model you're actually using */
  actualPricing: PricingModelSchema,
  /** Pricing for comparison (e.g., what you'd pay with Claude Code) */
  comparisonPricing: PricingModelSchema,
  timeEstimates: TimeEstimatesSchema.optional(),
});

/**
 * Commit message configuration schema
 */
export const CommitConfigSchema = z.object({
  /** Path to custom prompt template file (e.g., .github/commit_template.md) */
  template: z.string().optional(),
  /** Custom commit types (overrides defaults) */
  types: z.array(z.object({
    type: z.string(),
    description: z.string(),
  })).optional(),
  /** Custom scopes (if not set, scopes are optional) */
  scopes: z.array(z.string()).optional(),
  /** Whether scopes are required */
  requireScope: z.boolean().default(false),
  /** Ticket/issue ID configuration */
  ticketId: z.object({
    /** Enable ticket ID detection from branch name */
    enabled: z.boolean().default(false),
    /** Regex pattern to match ticket IDs (default: JIRA-style [A-Z]+-[0-9]+) */
    pattern: z.string().default("[A-Z]{2,10}-\\d+"),
    /** Whether ticket ID is required in commit message */
    required: z.boolean().default(false),
  }).optional(),
  /** Max subject line length */
  maxSubjectLength: z.number().positive().default(72),
  /** Max body line length */
  maxBodyLength: z.number().positive().default(100),
  /** Always include a body/description in commit messages */
  requireBody: z.boolean().default(true),
});

/**
 * Complete sg configuration schema
 */
export const SgConfigSchema = z.object({
  git: GitConfigSchema,
  ai: AiConfigSchema,
  output: OutputConfigSchema,
  tracking: TrackingConfigSchema.optional(),
  commit: CommitConfigSchema.optional(),
});

/**
 * Partial config schema for user config files
 */
export const PartialSgConfigSchema = z.object({
  git: GitConfigSchema.partial().optional(),
  ai: AiConfigSchema.partial().optional(),
  output: OutputConfigSchema.partial().optional(),
  tracking: TrackingConfigSchema.partial().optional(),
  commit: CommitConfigSchema.partial().optional(),
});

/**
 * Inferred types from schemas
 */
export type SgConfig = z.infer<typeof SgConfigSchema>;
export type PartialSgConfig = z.infer<typeof PartialSgConfigSchema>;
export type GitConfig = z.infer<typeof GitConfigSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;
export type ModelTiers = z.infer<typeof ModelTiersSchema>;
export type PricingModel = z.infer<typeof PricingModelSchema>;
export type TimeEstimates = z.infer<typeof TimeEstimatesSchema>;
export type TrackingConfig = z.infer<typeof TrackingConfigSchema>;
export type CommitConfig = z.infer<typeof CommitConfigSchema>;

/**
 * Default configuration values
 */

/**
 * Default model tiers for different task complexities
 */
export const DEFAULT_MODEL_TIERS: ModelTiers = {
  max: "anthropic/claude-sonnet-4-5", // Most capable, ~$3/$15 per M tokens
  medium: "anthropic/claude-haiku-4.5", // Balanced, ~$0.40/$2 per M tokens
  small: "anthropic/claude-haiku-4", // Fast/cheap, ~$0.25/$1.25 per M tokens
};

/**
 * Default time estimates for different script types (in minutes)
 */
export const DEFAULT_TIME_ESTIMATES: TimeEstimates = {
  gitCommit: 5, // Writing a good commit message manually
  gitSquash: 10, // Squashing commits and writing summary
  tsFix: 15, // Fixing TypeScript errors manually
  auditCode: 30, // Manual security audit
  auditDeps: 20, // Manual dependency audit
  auditPatterns: 25, // Manual pattern analysis
  default: 10, // Default for unknown scripts
};

/**
 * Default conventional commit types
 */
export const DEFAULT_COMMIT_TYPES = [
  { type: "feat", description: "A new feature" },
  { type: "fix", description: "A bug fix" },
  { type: "docs", description: "Documentation only changes" },
  { type: "style", description: "Changes that do not affect the meaning of the code" },
  { type: "refactor", description: "A code change that neither fixes a bug nor adds a feature" },
  { type: "perf", description: "A code change that improves performance" },
  { type: "test", description: "Adding missing tests or correcting existing tests" },
  { type: "build", description: "Changes that affect the build system or external dependencies" },
  { type: "ci", description: "Changes to CI configuration files and scripts" },
  { type: "chore", description: "Other changes that don't modify src or test files" },
  { type: "revert", description: "Reverts a previous commit" },
];

/**
 * Default commit configuration
 */
export const DEFAULT_COMMIT_CONFIG: CommitConfig = {
  types: DEFAULT_COMMIT_TYPES,
  requireScope: false,
  maxSubjectLength: 72,
  maxBodyLength: 100,
  requireBody: true,
};

/**
 * Default tracking configuration
 */
export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  enabled: true,
  usageFile: ".cache/token-usage.json",
  developerHourlyRate: 100, // $100/hour
  actualPricing: {
    name: "Claude Haiku 4.5 (OpenRouter)",
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cacheDiscount: 0.9,
  },
  comparisonPricing: {
    name: "Claude Sonnet 4.5 (Claude Code)",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheDiscount: 0.9,
  },
  timeEstimates: DEFAULT_TIME_ESTIMATES,
};

export const DEFAULT_CONFIG: SgConfig = {
  git: {
    baseBranch: "main",
    requireJiraId: false,
    autoSquash: false,
    forceWithLease: true,
    lintStagedCmd: false,
  },
  ai: {
    provider: "openrouter",
    model: "anthropic/claude-haiku-4.5",
    modelTiers: DEFAULT_MODEL_TIERS,
    cacheEnabled: true,
  },
  output: {
    verbose: false,
    quiet: false,
    json: false,
    colors: true,
  },
};

/**
 * Validate a partial config from user config file
 */
export const validatePartialConfig = (config: unknown): PartialSgConfig => {
  return PartialSgConfigSchema.parse(config);
};

/**
 * Validate a complete config
 */
export const validateConfig = (config: unknown): SgConfig => {
  return SgConfigSchema.parse(config);
};

/**
 * Safe validation that returns a result object instead of throwing
 */
export const safeValidateConfig = (
  config: unknown
): { success: true; data: SgConfig } | { success: false; error: z.ZodError } => {
  const result = SgConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
};

/**
 * Safe validation for partial config
 */
export const safeValidatePartialConfig = (
  config: unknown
): { success: true; data: PartialSgConfig } | { success: false; error: z.ZodError } => {
  const result = PartialSgConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
};
