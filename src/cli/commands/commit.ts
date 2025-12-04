/**
 * sg commit - Generate AI-powered commit messages
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { COLORS, getProjectRoot, git, logger, runCommand } from "@/utils/common.ts";
import { getConfig } from "@/utils/config.ts";
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

const runLintOnStagedFiles = async (): Promise<void> => {
  const config = getConfig();
  const lintCmd = config.git.lintStagedCmd;

  // Skip linting if disabled or not a valid command string
  if (!lintCmd || typeof lintCmd !== "string") {
    return;
  }

  console.log(`\n${COLORS.cyan}Running lint on staged files...${COLORS.reset}`);
  try {
    const { stdout: stagedFiles } = await runCommand(
      ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      { silent: true }
    );

    const filesToCheck = stagedFiles.split("\n").filter(Boolean);

    if (filesToCheck.length > 0) {
      // Run the configured lint command
      // The command can use $FILES placeholder for file list
      const cmdWithFiles = lintCmd.includes("$FILES")
        ? lintCmd.replace("$FILES", filesToCheck.join(" "))
        : `${lintCmd} ${filesToCheck.join(" ")}`;

      await runCommand(["sh", "-c", cmdWithFiles], {
        silent: false,
        ignoreExitCode: true,
      });

      // Re-stage files that may have been modified by the linter
      for (const file of filesToCheck) {
        await runCommand(["git", "add", file], { silent: true });
      }

      console.log(`${COLORS.green}✓${COLORS.reset} Lint completed`);
    }
  } catch {
    console.log(`${COLORS.yellow}Lint check had issues, continuing with commit${COLORS.reset}`);
  }
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

    // Auto-sync with base branch if configured
    const appConfig = getConfig();
    if (appConfig.git.autoSync && appConfig.git.syncStrategy !== "none") {
      const { baseBranch, syncStrategy } = appConfig.git;

      if (isDryRun()) {
        output.dryRunAction(`Sync with ${baseBranch}`, `strategy: ${syncStrategy}`);
      } else {
        output.info(`Syncing with ${baseBranch} (${syncStrategy})...`);
        const result = await git.syncWithBase(baseBranch, syncStrategy);

        if (result.success) {
          logger.success(result.message);
        } else {
          logger.error(result.message);
          process.exit(1);
        }
      }
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

    // Run lint on staged files before generating commit message
    if (isDryRun() && appConfig.git.lintStagedCmd) {
      output.dryRunAction("Run lint on staged files", `cmd: ${appConfig.git.lintStagedCmd}`);
    } else {
      await runLintOnStagedFiles();
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
