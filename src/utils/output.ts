/**
 * Output utilities for smart scripts
 *
 * Provides:
 * - JSON output mode for CI/CD
 * - Verbose/quiet modes
 * - Dry-run support
 * - Consistent output formatting
 */

import { COLORS } from "./common";
import { getConfig, VERSION, VERSION_DATE } from "./config";

export interface OutputOptions {
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  dryRun?: boolean;
  colors?: boolean;
}

export interface ScriptResult<T = Record<string, unknown>> {
  success: boolean;
  command: string;
  version: string;
  timestamp: string;
  duration?: number;
  dryRun: boolean;
  data: T;
  errors?: string[];
  warnings?: string[];
}

let outputOptions: OutputOptions = {};
let startTime: number = Date.now();

/**
 * Initialize output options from CLI args and config
 */
export const initOutput = (options: OutputOptions): void => {
  const config = getConfig();
  outputOptions = {
    verbose: options.verbose ?? config.output.verbose,
    quiet: options.quiet ?? config.output.quiet,
    json: options.json ?? config.output.json,
    dryRun: options.dryRun ?? false,
    colors: options.colors ?? config.output.colors,
  };
  startTime = Date.now();
};

/**
 * Get current output options
 */
export const getOutputOptions = (): OutputOptions => outputOptions;

/**
 * Check if running in dry-run mode
 */
export const isDryRun = (): boolean => outputOptions.dryRun ?? false;

/**
 * Check if running in JSON mode
 */
export const isJsonMode = (): boolean => outputOptions.json ?? false;

/**
 * Check if verbose mode is enabled
 */
export const isVerbose = (): boolean => outputOptions.verbose ?? false;

/**
 * Check if quiet mode is enabled
 */
export const isQuiet = (): boolean => outputOptions.quiet ?? false;

/**
 * Get color code (returns empty string if colors disabled)
 */
const c = (color: keyof typeof COLORS): string => {
  if (!outputOptions.colors) return "";
  return COLORS[color];
};

/**
 * Output module - respects verbose/quiet/json modes
 */
export const output = {
  /**
   * Regular info message (hidden in quiet mode)
   */
  info: (msg: string): void => {
    if (outputOptions.quiet || outputOptions.json) return;
    console.log(msg);
  },

  /**
   * Success message (always shown unless JSON mode)
   */
  success: (msg: string): void => {
    if (outputOptions.json) return;
    console.log(`${c("green")}✓${c("reset")} ${msg}`);
  },

  /**
   * Warning message (always shown unless JSON mode)
   */
  warn: (msg: string): void => {
    if (outputOptions.json) return;
    console.log(`${c("yellow")}⚠${c("reset")} ${msg}`);
  },

  /**
   * Error message (always shown unless JSON mode)
   */
  error: (msg: string): void => {
    if (outputOptions.json) return;
    console.error(`${c("red")}✖${c("reset")} ${msg}`);
  },

  /**
   * Verbose message (only shown in verbose mode)
   */
  verbose: (msg: string): void => {
    if (!outputOptions.verbose || outputOptions.json) return;
    console.log(`${c("dim")}[verbose] ${msg}${c("reset")}`);
  },

  /**
   * Debug message (only shown in verbose mode)
   */
  debug: (msg: string): void => {
    if (!outputOptions.verbose || outputOptions.json) return;
    console.log(`${c("gray")}[debug] ${msg}${c("reset")}`);
  },

  /**
   * Step indicator
   */
  step: (step: number | string, msg: string): void => {
    if (outputOptions.quiet || outputOptions.json) return;
    console.log(`${c("blue")}[${step}]${c("reset")} ${msg}`);
  },

  /**
   * Header (section title)
   */
  header: (msg: string): void => {
    if (outputOptions.quiet || outputOptions.json) return;
    console.log("");
    console.log(`${c("bold")}${c("cyan")}${msg}${c("reset")}`);
    console.log(`${c("dim")}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c("reset")}`);
    console.log("");
  },

  /**
   * Dry-run notice
   */
  dryRunNotice: (): void => {
    if (!outputOptions.dryRun || outputOptions.json) return;
    console.log("");
    console.log(`${c("yellow")}${c("bold")}🔍 DRY RUN MODE - No changes will be made${c("reset")}`);
    console.log(`${c("dim")}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c("reset")}`);
    console.log("");
  },

  /**
   * Dry-run action preview
   */
  dryRunAction: (action: string, details?: string): void => {
    if (!outputOptions.dryRun) return;
    if (outputOptions.json) return;
    console.log(`${c("yellow")}[dry-run]${c("reset")} Would: ${action}`);
    if (details) {
      console.log(`${c("dim")}          ${details}${c("reset")}`);
    }
  },

  /**
   * Raw output (bypasses all modes)
   */
  raw: (msg: string): void => {
    console.log(msg);
  },
};

/**
 * Create a JSON result object
 */
export const createResult = <T>(
  command: string,
  success: boolean,
  data: T,
  errors?: string[],
  warnings?: string[]
): ScriptResult<T> => {
  return {
    success,
    command,
    version: VERSION,
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    dryRun: outputOptions.dryRun ?? false,
    data,
    errors,
    warnings,
  };
};

/**
 * Output final result (handles JSON mode)
 */
export const outputResult = <T>(result: ScriptResult<T>): void => {
  if (outputOptions.json) {
    console.log(JSON.stringify(result, null, 2));
  }
};

/**
 * Show version info
 */
export const showVersion = (scriptName: string): void => {
  if (outputOptions.json) {
    console.log(
      JSON.stringify({
        script: scriptName,
        version: VERSION,
        date: VERSION_DATE,
      })
    );
  } else {
    console.log(`${scriptName} v${VERSION} (${VERSION_DATE})`);
  }
};

/**
 * Parse common output options from CLI args
 */
export const parseOutputOptions = (values: Record<string, unknown>): OutputOptions => {
  return {
    verbose: (values.verbose as boolean) || false,
    quiet: (values.quiet as boolean) || false,
    json: (values.json as boolean) || false,
    dryRun: (values["dry-run"] as boolean) || false,
    colors: !(values["no-color"] as boolean),
  };
};

/**
 * Common CLI options definition for parseArgs
 */
export const commonOptions = {
  verbose: { type: "boolean" as const },
  quiet: { type: "boolean" as const, short: "q" },
  json: { type: "boolean" as const },
  "dry-run": { type: "boolean" as const },
  "no-color": { type: "boolean" as const },
  version: { type: "boolean" as const, short: "V" },
};
