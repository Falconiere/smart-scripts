/**
 * Shared configuration module for sg CLI
 *
 * Configuration priority (highest to lowest):
 * 1. CLI arguments
 * 2. Environment variables (SG_* prefix)
 * 3. Per-project config (sg.config.ts in project root)
 * 4. Global config (~/.config/sg/config.ts)
 * 5. Defaults
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { getProjectRoot } from "@/utils/common.ts";
import {
  type SgConfig,
  type PartialSgConfig,
  type TrackingConfig,
  DEFAULT_CONFIG,
  DEFAULT_TRACKING_CONFIG,
  safeValidatePartialConfig,
  validateConfig,
} from "@/schemas/config.ts";

export const VERSION = "1.0.0";
export const VERSION_DATE = "2025-12-03";

// Re-export types for external use
export type { SgConfig, PartialSgConfig, TrackingConfig, PricingModel, TimeEstimates } from "@/schemas/config.ts";

// Keep legacy alias for backward compatibility
export type SmartConfig = SgConfig;

let loadedConfig: SgConfig | null = null;

/**
 * Get the global config directory path
 */
const getGlobalConfigDir = (): string => {
  return path.join(homedir(), ".config", "sg");
};

/**
 * Get the global config file path
 */
const getGlobalConfigPath = (): string => {
  return path.join(getGlobalConfigDir(), "config.ts");
};

/**
 * Load and validate a config file if it exists
 */
const loadConfigFile = async (configPath: string): Promise<PartialSgConfig> => {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const imported: unknown = await import(configPath);
    const configData =
      typeof imported === "object" && imported !== null && "default" in imported
        ? (imported as { default: unknown }).default
        : imported;

    // Validate with Zod
    const result = safeValidatePartialConfig(configData);
    if (!result.success) {
      console.warn(`Warning: Invalid config in ${configPath}:`);
      for (const issue of result.error.issues) {
        console.warn(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
      return {};
    }

    return result.data;
  } catch (error) {
    // Config file exists but couldn't be loaded
    if (error instanceof Error && !error.message.includes("Cannot find module")) {
      console.warn(`Warning: Could not load config from ${configPath}: ${error.message}`);
    }
    return {};
  }
};

/**
 * Deep merge two config objects
 */
const mergeConfigs = (base: SgConfig, override: PartialSgConfig): SgConfig => {
  const result: SgConfig = {
    git: { ...base.git, ...override.git },
    ai: { ...base.ai, ...override.ai },
    output: { ...base.output, ...override.output },
  };

  // Merge tracking config if provided
  if (override.tracking) {
    result.tracking = {
      ...base.tracking,
      ...override.tracking,
      // Deep merge nested objects
      actualPricing: {
        ...(base.tracking?.actualPricing ?? DEFAULT_TRACKING_CONFIG.actualPricing),
        ...override.tracking.actualPricing,
      },
      comparisonPricing: {
        ...(base.tracking?.comparisonPricing ?? DEFAULT_TRACKING_CONFIG.comparisonPricing),
        ...override.tracking.comparisonPricing,
      },
      timeEstimates: {
        ...(base.tracking?.timeEstimates ?? DEFAULT_TRACKING_CONFIG.timeEstimates),
        ...override.tracking.timeEstimates,
      },
    } as TrackingConfig;
  }

  return result;
};

/**
 * Load configuration from config files and environment
 *
 * Priority: defaults -> global config -> per-project config -> env vars
 */
export const loadConfig = async (): Promise<SgConfig> => {
  if (loadedConfig) return loadedConfig;

  // Start with defaults
  let config: SgConfig = { ...DEFAULT_CONFIG };

  // Load global config (~/.config/sg/config.ts)
  const globalConfigPath = getGlobalConfigPath();
  const globalConfig = await loadConfigFile(globalConfigPath);
  config = mergeConfigs(config, globalConfig);

  // Load per-project config (sg.config.ts in project root)
  const projectRoot = getProjectRoot();
  const projectConfigPath = path.join(projectRoot, "sg.config.ts");
  const projectConfig = await loadConfigFile(projectConfigPath);
  config = mergeConfigs(config, projectConfig);

  // Also support legacy smart.config.ts for backward compatibility
  const legacyConfigPath = path.join(projectRoot, "smart.config.ts");
  if (!existsSync(projectConfigPath) && existsSync(legacyConfigPath)) {
    const legacyConfig = await loadConfigFile(legacyConfigPath);
    config = mergeConfigs(config, legacyConfig);
  }

  // Override from environment variables (SG_* prefix)
  // Also support legacy SMART_* prefix for backward compatibility
  const envBaseBranch = process.env["SG_BASE_BRANCH"] ?? process.env["SMART_BASE_BRANCH"];
  if (envBaseBranch) {
    config.git.baseBranch = envBaseBranch;
  }

  if (process.env["SG_VERBOSE"] === "1" || process.env["SMART_VERBOSE"] === "1") {
    config.output.verbose = true;
  }

  if (process.env["SG_QUIET"] === "1" || process.env["SMART_QUIET"] === "1") {
    config.output.quiet = true;
  }

  if (process.env["SG_JSON"] === "1" || process.env["SMART_JSON"] === "1") {
    config.output.json = true;
  }

  if (process.env["NO_COLOR"] === "1") {
    config.output.colors = false;
  }

  const envModel = process.env["SG_MODEL"] ?? process.env["OPENROUTER_MODEL"];
  if (envModel) {
    config.ai.model = envModel;
  }

  // Validate final config
  loadedConfig = validateConfig(config);
  return loadedConfig;
};

/**
 * Get config synchronously (must call loadConfig first)
 */
export const getConfig = (): SgConfig => {
  return loadedConfig ?? DEFAULT_CONFIG;
};

/**
 * Get tracking config with defaults
 */
export const getTrackingConfig = (): TrackingConfig => {
  const config = getConfig();
  return config.tracking ?? DEFAULT_TRACKING_CONFIG;
};

/**
 * Reset config (useful for testing)
 */
export const resetConfig = (): void => {
  loadedConfig = null;
};

/**
 * Get paths for config files (useful for init command)
 */
export const getConfigPaths = (): {
  global: string;
  globalDir: string;
  project: string;
} => ({
  global: getGlobalConfigPath(),
  globalDir: getGlobalConfigDir(),
  project: path.join(getProjectRoot(), "sg.config.ts"),
});
