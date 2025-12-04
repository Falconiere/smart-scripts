/**
 * Zod schemas for CLI command arguments
 *
 * These schemas validate command-line arguments before processing.
 */

import { z } from "zod/v4";

/**
 * Global CLI options available to all commands
 */
export const GlobalOptionsSchema = z.object({
  verbose: z.boolean().optional(),
  quiet: z.boolean().optional(),
  json: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  noColor: z.boolean().optional(),
});

/**
 * Init command arguments
 */
export const InitArgsSchema = GlobalOptionsSchema.extend({
  global: z.boolean().default(false),
  force: z.boolean().default(false),
});

/**
 * Commit command arguments
 */
export const CommitArgsSchema = GlobalOptionsSchema.extend({
  action: z.enum(["commit"]).optional(),
});

/**
 * Staging mode for push command
 */
export const StageModeSchema = z.enum(["all", "tracked", "interactive"]).default("all");

/**
 * Push command arguments
 */
export const PushArgsSchema = GlobalOptionsSchema.extend({
  stageMode: StageModeSchema.optional(),
  skipPush: z.boolean().default(false),
  skipPr: z.boolean().default(false),
  prDraft: z.boolean().default(false),
  confirm: z.boolean().default(false),
  yes: z.boolean().default(false),
});

/**
 * Squash command arguments
 */
export const SquashArgsSchema = GlobalOptionsSchema.extend({
  base: z.string().optional(),
  skipPush: z.boolean().default(false),
  edit: z.boolean().default(false),
  yes: z.boolean().default(false),
});

/**
 * Rebase command arguments
 */
export const RebaseArgsSchema = GlobalOptionsSchema.extend({
  branch: z.string().optional(),
  onto: z.string().optional(),
  interactive: z.boolean().default(false),
  yes: z.boolean().default(false),
  abortOnConflict: z.boolean().default(false),
});

/**
 * Token command subcommands
 */
export const TokenSubcommandSchema = z.enum(["summary", "watch", "detailed", "csv", "clear"]).optional();

/**
 * Token command arguments
 */
export const TokenArgsSchema = GlobalOptionsSchema.extend({
  command: TokenSubcommandSchema,
  days: z.number().min(1).max(365).default(30),
  interval: z.number().min(1).max(3600).default(5),
});

/**
 * Inferred types from schemas
 */
export type GlobalOptions = z.infer<typeof GlobalOptionsSchema>;
export type InitArgs = z.infer<typeof InitArgsSchema>;
export type CommitArgs = z.infer<typeof CommitArgsSchema>;
export type StageMode = z.infer<typeof StageModeSchema>;
export type PushArgs = z.infer<typeof PushArgsSchema>;
export type SquashArgs = z.infer<typeof SquashArgsSchema>;
export type RebaseArgs = z.infer<typeof RebaseArgsSchema>;
export type TokenSubcommand = z.infer<typeof TokenSubcommandSchema>;
export type TokenArgs = z.infer<typeof TokenArgsSchema>;

/**
 * Validate init command arguments
 */
export const validateInitArgs = (args: unknown): InitArgs => {
  return InitArgsSchema.parse(args);
};

/**
 * Validate commit command arguments
 */
export const validateCommitArgs = (args: unknown): CommitArgs => {
  return CommitArgsSchema.parse(args);
};

/**
 * Validate push command arguments
 */
export const validatePushArgs = (args: unknown): PushArgs => {
  return PushArgsSchema.parse(args);
};

/**
 * Validate squash command arguments
 */
export const validateSquashArgs = (args: unknown): SquashArgs => {
  return SquashArgsSchema.parse(args);
};

/**
 * Validate rebase command arguments
 */
export const validateRebaseArgs = (args: unknown): RebaseArgs => {
  return RebaseArgsSchema.parse(args);
};

/**
 * Validate token command arguments
 */
export const validateTokenArgs = (args: unknown): TokenArgs => {
  return TokenArgsSchema.parse(args);
};
