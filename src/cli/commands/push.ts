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

const checkRemoteBranchExists = async (branch: string): Promise<boolean> => {
  try {
    const { exitCode } = await runCommand(
      ["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
      { silent: true, ignoreExitCode: true }
    );
    return exitCode === 0;
  } catch {
    return false;
  }
};

interface UpstreamStatus {
  setUpstream: boolean;
  remoteBranchDeleted: boolean;
  isNewBranch: boolean;
}

const checkUpstreamStatus = async (currentBranch: string, baseBranch: string): Promise<UpstreamStatus> => {
  const upstream = await git.getUpstreamBranch();

  // Fetch to get latest remote state
  await git.fetch();

  if (upstream) {
    const upstreamBranch = upstream.replace(/^origin\//, "");

    // Check if the remote branch still exists
    const remoteExists = await checkRemoteBranchExists(upstreamBranch);

    if (!remoteExists) {
      // Remote branch was deleted
      console.log(
        `${COLORS.yellow}⚠️  Remote branch '${upstreamBranch}' no longer exists (may have been deleted)${COLORS.reset}`
      );

      // Check if there's a merged PR for this branch
      try {
        const { stdout, exitCode } = await runCommand(
          ["gh", "pr", "list", "--head", upstreamBranch, "--state", "merged", "--json", "number,title", "--limit", "1"],
          { silent: true, ignoreExitCode: true }
        );
        if (exitCode === 0 && stdout.trim() !== "[]") {
          const prs = JSON.parse(stdout);
          if (prs.length > 0) {
            console.log(
              `${COLORS.cyan}ℹ️  Found merged PR #${prs[0].number}: ${prs[0].title}${COLORS.reset}`
            );
            console.log(
              `${COLORS.yellow}This branch was already merged. Consider switching to ${baseBranch} or creating a new branch.${COLORS.reset}`
            );
          }
        }
      } catch {
        // gh CLI not available or failed, continue anyway
      }

      return { setUpstream: true, remoteBranchDeleted: true, isNewBranch: false };
    }

    if (upstreamBranch === currentBranch) {
      return { setUpstream: false, remoteBranchDeleted: false, isNewBranch: false };
    }

    console.log(
      `${COLORS.yellow}Upstream branch (${upstreamBranch}) doesn't match current branch (${currentBranch}).${COLORS.reset}`
    );
    console.log(`${COLORS.cyan}Will reset upstream to origin/${currentBranch} on push.${COLORS.reset}`);
    return { setUpstream: true, remoteBranchDeleted: false, isNewBranch: false };
  }

  console.log(`${COLORS.yellow}Branch has no upstream. Will set upstream on push.${COLORS.reset}`);
  return { setUpstream: true, remoteBranchDeleted: false, isNewBranch: true };
};

const isWorkingTreeClean = async (): Promise<boolean> => {
  const hasUnstaged = await git.hasUnstagedChanges();
  const hasUntracked = await git.hasUntrackedFiles();
  const hasStaged = await git.hasStagedChanges();
  return !hasUnstaged && !hasUntracked && !hasStaged;
};

const hasUnpushedCommits = async (): Promise<boolean> => {
  try {
    const upstream = await git.getUpstreamBranch();
    if (!upstream) {
      // No upstream means all local commits are unpushed
      const { stdout } = await runCommand(["git", "rev-list", "--count", "HEAD"], { silent: true });
      return Number.parseInt(stdout.trim(), 10) > 0;
    }
    // Check commits ahead of upstream
    const { stdout } = await runCommand(
      ["git", "rev-list", "--count", `${upstream}..HEAD`],
      { silent: true }
    );
    return Number.parseInt(stdout.trim(), 10) > 0;
  } catch {
    return false;
  }
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

    const appConfig = getConfig();
    const currentBranch = await git.getCurrentBranch();
    console.log(`${COLORS.blue}Current branch: ${COLORS.yellow}${currentBranch}${COLORS.reset}`);

    const upstreamStatus = await checkUpstreamStatus(currentBranch, mainBranch);

    // Handle deleted remote branch
    if (upstreamStatus.remoteBranchDeleted && !config.autoYes) {
      console.log("");
      console.log(`${COLORS.cyan}Options:${COLORS.reset}`);
      console.log(`  ${COLORS.green}[p]${COLORS.reset} Push anyway (will create new remote branch and PR)`);
      console.log(`  ${COLORS.yellow}[s]${COLORS.reset} Switch to ${mainBranch} branch`);
      console.log(`  ${COLORS.red}[a]${COLORS.reset} Abort`);
      console.log("");

      const answer = await new Promise<string>((resolve) => {
        const rl = require("node:readline").createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(`${COLORS.cyan}Your choice [p/s/a]: ${COLORS.reset}`, (ans: string) => {
          rl.close();
          resolve(ans.trim().toLowerCase());
        });
      });

      if (answer === "s" || answer === "switch") {
        console.log(`${COLORS.cyan}Switching to ${mainBranch}...${COLORS.reset}`);
        await runCommand(["git", "checkout", mainBranch], { silent: false });
        logger.success(`Switched to ${mainBranch}`);
        process.exit(0);
      } else if (answer === "a" || answer === "abort") {
        logger.warn("Aborted by user");
        process.exit(0);
      }
      // Otherwise continue with push
      console.log(`${COLORS.cyan}Continuing with push...${COLORS.reset}`);
    }

    const workingTreeClean = await isWorkingTreeClean();
    const hasCommitsToPush = await hasUnpushedCommits();

    if (workingTreeClean && !hasCommitsToPush) {
      logger.success("Working tree is clean and no commits to push");
      process.exit(0);
    }

    if (workingTreeClean && hasCommitsToPush) {
      console.log(`${COLORS.cyan}Working tree is clean. Proceeding to push existing commits...${COLORS.reset}`);
    } else {
      // Handle uncommitted changes
      console.log(`\n${COLORS.yellow}Current status:${COLORS.reset}`);
      await runCommand(["git", "status", "--short"], { silent: false });

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
      const pushDesc = upstreamStatus.setUpstream ? "with -u (set upstream)" : "";
      output.dryRunAction(`Push to origin/${currentBranch}`, pushDesc);

      if (!config.skipPR) {
        output.dryRunAction("Check/create PR", config.prDraft ? "(draft)" : "");
      }
      output.success("Dry run completed successfully!");
    } else {
      try {
        await performPush(currentBranch, false, upstreamStatus.setUpstream, config.autoYes);

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
