/**
 * sg commit - Generate AI-powered commit messages
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { COLORS, getProjectRoot, git, logger } from "@/utils/common.ts";
import { getModelForComplexity } from "@/utils/openrouter.ts";
import { isDryRun, output } from "@/utils/output.ts";
import { generateCommitMessage } from "@/smart-git-commit/generator.ts";
import { CommitArgsSchema } from "@/schemas/cli.ts";

const hasAnyChanges = async (): Promise<boolean> => {
  const hasUnstaged = await git.hasUnstagedChanges();
  const hasUntracked = await git.hasUntrackedFiles();
  return hasUnstaged || hasUntracked;
};

const autoStageChanges = async (): Promise<void> => {
  output.info("No staged changes found. Auto-staging all changes...");
  await git.stageAll();
  logger.success("Staged all changes");
};

interface CommitCommandArgs {
  action?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  dryRun?: boolean;
  noColor?: boolean;
}

const commitCommand: CommandModule<object, CommitCommandArgs> = {
  command: "commit [action]",
  describe: "Generate AI-powered commit messages following conventional commit format",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        describe: "Action to perform after generating message",
        choices: ["commit"] as const,
        type: "string",
      })
      .example("$0 commit", "Generate message and save to .git/COMMIT_MSG_GENERATED")
      .example("$0 commit commit", "Generate and auto-commit")
      .example("$0 commit --dry-run", "Preview without making changes");
  },
  handler: async (argv: ArgumentsCamelCase<CommitCommandArgs>) => {
    // Validate arguments with Zod
    const args = CommitArgsSchema.parse(argv);

    if (isDryRun()) {
      output.dryRunNotice();
    }

    const autoCommit = args.action === "commit";
    const model = getModelForComplexity("MEDIUM");

    if (!(await git.isRepo())) {
      logger.error("Not a git repository");
      process.exit(1);
    }

    // Auto-stage if no staged changes but there are unstaged changes
    if (!(await git.hasStagedChanges())) {
      if (await hasAnyChanges()) {
        if (isDryRun()) {
          output.dryRunAction("Auto-stage all changes");
        } else {
          await autoStageChanges();
        }
      } else {
        logger.success("Nothing to commit - working tree clean");
        process.exit(0);
      }
    }

    output.info("Analyzing staged changes...");

    const message = await generateCommitMessage(model);

    console.log(`\n${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.yellow}Generated Commit Message:${COLORS.reset}`);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(message);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}\n`);

    const msgFile = join(getProjectRoot(), ".git", "COMMIT_MSG_GENERATED");
    await writeFile(msgFile, message);

    if (autoCommit) {
      if (isDryRun()) {
        output.dryRunAction("Commit staged changes with generated message");
        output.success("Dry run completed - no commit was made");
      } else {
        output.info("Committing changes...");
        await git.commit(message);
        output.success("Changes committed successfully!");
      }
    } else {
      console.log(`${COLORS.yellow}Options:${COLORS.reset}`);
      console.log("   1. Commit with this message:");
      console.log(`      git commit -F ${msgFile}`);
      console.log("");
      console.log("   2. Edit and commit:");
      console.log(`      git commit -e -F ${msgFile}`);
      console.log("");
      console.log("   3. Auto-commit:");
      console.log("      sg commit commit");
    }
  },
};

export default commitCommand;
