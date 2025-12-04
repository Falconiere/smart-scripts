/**
 * sg push - Full git workflow: stage, commit, push
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { COLORS, confirm, getProjectRoot, git, logger, runCommand } from "@/utils/common.ts";
import { getConfig } from "@/utils/config.ts";
import { getModelForComplexity } from "@/utils/openrouter.ts";
import { isDryRun, output } from "@/utils/output.ts";
import { getMainBranch } from "@/smart-git-push/config.ts";
import { ensurePR } from "@/smart-git-push/pr.ts";
import { performPush } from "@/smart-git-push/push.ts";
import { stageChanges } from "@/smart-git-push/staging.ts";
import { generateCommitMessage as generateMessage } from "@/smart-git-commit/generator.ts";
import { PushArgsSchema, type StageMode } from "@/schemas/cli.ts";

interface PushCommandArgs {
  stageMode?: string;
  skipPush?: boolean;
  skipPr?: boolean;
  prDraft?: boolean;
  confirm?: boolean;
  yes?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  dryRun?: boolean;
  noColor?: boolean;
}

const checkUpstreamStatus = async (currentBranch: string): Promise<boolean> => {
  const upstream = await git.getUpstreamBranch();

  if (upstream) {
    const upstreamBranch = upstream.replace(/^origin\//, "");
    if (upstreamBranch === currentBranch) {
      return false;
    }
    console.log(
      `${COLORS.yellow}Upstream branch (${upstreamBranch}) doesn't match current branch (${currentBranch}).${COLORS.reset}`
    );
    console.log(`${COLORS.cyan}Will reset upstream to origin/${currentBranch} on push.${COLORS.reset}`);
    return true;
  }

  console.log(`${COLORS.yellow}Branch has no upstream. Will set upstream on push.${COLORS.reset}`);
  return true;
};

const isWorkingTreeClean = async (): Promise<boolean> => {
  const hasUnstaged = await git.hasUnstagedChanges();
  const hasUntracked = await git.hasUntrackedFiles();
  const hasStaged = await git.hasStagedChanges();
  return !hasUnstaged && !hasUntracked && !hasStaged;
};

const runLintOnStagedFiles = async (): Promise<void> => {
  const config = getConfig();
  const lintCmd = config.git.lintStagedCmd;

  // Skip linting if disabled or not a valid command string
  if (!lintCmd || typeof lintCmd !== "string") {
    return;
  }

  console.log(`\n${COLORS.cyan}Running lint on staged files...${COLORS.reset}`);

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

    const { exitCode } = await runCommand(["sh", "-c", cmdWithFiles], {
      silent: false,
      ignoreExitCode: true,
    });

    if (exitCode !== 0) {
      logger.error("Lint check failed. Please fix the issues before committing.");
      process.exit(1);
    }

    // Re-stage files that may have been modified by the linter
    for (const file of filesToCheck) {
      await runCommand(["git", "add", file], { silent: true });
    }

    console.log(`${COLORS.green}✓${COLORS.reset} Lint completed`);
  }
};

const generateAndCommit = async (): Promise<void> => {
  console.log(`\n${COLORS.yellow}Generating AI commit message...${COLORS.reset}`);

  try {
    const model = getModelForComplexity("MEDIUM");
    const message = await generateMessage(model);

    console.log(`\n${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.yellow}Generated Commit Message:${COLORS.reset}`);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(message);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}\n`);

    const msgFile = join(getProjectRoot(), ".git", "COMMIT_MSG_GENERATED");
    await writeFile(msgFile, message);

    output.info("Committing changes...");
    await git.commit(message);
    output.success("Changes committed successfully!");
  } catch (error_) {
    logger.error("Commit failed");
    if (error_ instanceof Error) logger.error(error_.message);
    process.exit(1);
  }
};

const pushCommand: CommandModule<object, PushCommandArgs> = {
  command: "push [stageMode]",
  describe: "Full git workflow: stage, commit, push",
  builder: (yargs) => {
    return yargs
      .positional("stageMode", {
        describe: "Staging mode",
        choices: ["all", "tracked", "interactive"] as const,
        default: "all",
        type: "string",
      })
      .option("skip-push", {
        type: "boolean",
        description: "Don't push after committing",
        default: false,
      })
      .option("skip-pr", {
        type: "boolean",
        description: "Skip automatic PR creation",
        default: false,
      })
      .option("pr-draft", {
        type: "boolean",
        description: "Create PR as draft",
        default: false,
      })
      .option("confirm", {
        alias: "c",
        type: "boolean",
        description: "Require confirmation before committing",
        default: false,
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        description: "Auto-confirm all prompts",
        default: false,
      })
      .example("$0 push -y", "Auto-confirm everything")
      .example("$0 push --dry-run", "Preview what would happen")
      .example("$0 push tracked -y", "Only stage tracked files");
  },
  handler: async (argv: ArgumentsCamelCase<PushCommandArgs>) => {
    // Validate arguments with Zod
    const args = PushArgsSchema.parse(argv);

    const mainBranch = getMainBranch();
    const config = {
      stageMode: (args.stageMode ?? "all") as StageMode,
      autoYes: args.yes ?? !args.confirm,
      skipPush: args.skipPush,
      skipPR: args.skipPr,
      prDraft: args.prDraft,
    };

    if (isDryRun()) {
      output.dryRunNotice();
    }

    logger.header("Smart Push - AI-Powered Git Workflow");

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

    const currentBranch = await git.getCurrentBranch();
    console.log(`${COLORS.blue}Current branch: ${COLORS.yellow}${currentBranch}${COLORS.reset}`);

    const setUpstream = await checkUpstreamStatus(currentBranch);

    if (await isWorkingTreeClean()) {
      logger.success("Working tree is clean - nothing to commit");
      process.exit(0);
    }

    console.log(`\n${COLORS.yellow}Current status:${COLORS.reset}`);
    await runCommand(["git", "status", "--short"], { silent: false });

    // Handle uncommitted changes
    if (!(await isWorkingTreeClean())) {
      if (isDryRun()) {
        output.dryRunAction("Stage changes", `mode: ${config.stageMode}`);
      } else {
        await stageChanges(config.stageMode);
      }

      if (!isDryRun() && !(await git.hasStagedChanges())) {
        logger.error("No changes staged for commit");
        process.exit(1);
      }

      if (isDryRun() && appConfig.git.lintStagedCmd) {
        output.dryRunAction("Run lint on staged files", `cmd: ${appConfig.git.lintStagedCmd}`);
      } else {
        await runLintOnStagedFiles();
      }

      console.log(`\n${COLORS.yellow}Changes to be committed:${COLORS.reset}`);
      await runCommand(["git", "diff", "--cached", "--stat"], { silent: false });

      if (!config.autoYes && !(await confirm("\nProceed with commit?"))) {
        logger.warn("Aborted by user");
        process.exit(0);
      }

      if (isDryRun()) {
        output.dryRunAction("Generate AI commit message");
        output.dryRunAction("Commit staged changes");
      } else {
        await generateAndCommit();
      }
    }

    // Handle push
    if (config.skipPush) {
      const message = isDryRun() ? "Dry run completed (push was skipped)" : "Changes committed (push skipped)";
      if (isDryRun()) {
        output.success(message);
      } else {
        logger.success(message);
      }
      return;
    }

    if (isDryRun()) {
      const pushDesc = setUpstream ? "with -u (set upstream)" : "";
      output.dryRunAction(`Push to origin/${currentBranch}`, pushDesc);

      if (!config.skipPR) {
        output.dryRunAction("Check/create PR", config.prDraft ? "(draft)" : "");
      }
      output.success("Dry run completed successfully!");
    } else {
      try {
        await performPush(currentBranch, false, setUpstream, config.autoYes);

        if (!config.skipPR) {
          await ensurePR(currentBranch, mainBranch, appConfig.ai.model, config.prDraft, config.autoYes);
        }
      } catch (error_) {
        logger.error("Push failed");
        console.log("You can push manually.");
        if (error_ instanceof Error) logger.error(error_.message);
        process.exit(1);
      }
    }
  },
};

export default pushCommand;
