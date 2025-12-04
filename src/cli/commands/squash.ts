/**
 * sg squash - Squash commits with AI-generated summary message
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { COLORS, confirm, getProjectRoot, git, logger, runCommand } from "@/utils/common.ts";
import { getModelForComplexity } from "@/utils/openrouter.ts";
import { generateSquashMessage } from "@/smart-git-squash/generator.ts";
import { performSquash } from "@/smart-git-squash/squash.ts";
import { SquashArgsSchema } from "@/schemas/cli.ts";

interface SquashCommandArgs {
  skipPush?: boolean;
  edit?: boolean;
  yes?: boolean;
  base?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  dryRun?: boolean;
  noColor?: boolean;
}

const squashCommand: CommandModule<object, SquashCommandArgs> = {
  command: "squash",
  describe: "Squash commits with AI-generated summary message",
  builder: (yargs) => {
    return yargs
      .option("skip-push", {
        type: "boolean",
        description: "Don't push after squashing",
        default: false,
      })
      .option("edit", {
        alias: "e",
        type: "boolean",
        description: "Edit the generated message before committing",
        default: false,
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        description: "Auto-confirm all prompts",
        default: false,
      })
      .option("base", {
        alias: "b",
        type: "string",
        description: "Base branch to compare against",
        default: "main",
      })
      .example("$0 squash -y", "Squash and auto-confirm")
      .example("$0 squash --base main", "Squash commits since main branch")
      .example("$0 squash --skip-push", "Squash without pushing");
  },
  handler: async (argv: ArgumentsCamelCase<SquashCommandArgs>) => {
    // Validate arguments with Zod
    const args = SquashArgsSchema.parse(argv);

    const model = getModelForComplexity("MEDIUM");
    const mainBranch = args.base ?? "main";
    const autoYes = args.yes;
    const skipPush = args.skipPush;
    const editMessage = args.edit;

    logger.header("Smart Squash - AI-Powered Commit Squashing");

    if (!(await git.isRepo())) {
      logger.error("Not a git repository");
      process.exit(1);
    }

    const currentBranch = await git.getCurrentBranch();
    console.log(`${COLORS.blue}Current branch: ${COLORS.yellow}${currentBranch}${COLORS.reset}`);

    if (currentBranch === mainBranch) {
      logger.error(`Cannot squash commits on ${mainBranch} branch`);
      console.log("Please switch to a feature branch first.");
      process.exit(1);
    }

    // Verify base branch exists
    try {
      await runCommand(["git", "rev-parse", "--verify", mainBranch], { silent: true });
    } catch {
      logger.error(`Base branch '${mainBranch}' not found`);
      process.exit(1);
    }

    const { stdout: commitCountStr } = await runCommand(
      ["git", "rev-list", "--count", `${mainBranch}..${currentBranch}`],
      { silent: true }
    );
    const commitCount = parseInt(commitCountStr.trim(), 10);

    if (commitCount === 0) {
      logger.success(`No commits to squash - branch is up to date with ${mainBranch}`);
      process.exit(0);
    }

    if (commitCount === 1) {
      logger.success("Only one commit in branch - no squashing needed");
      process.exit(0);
    }

    console.log(`${COLORS.yellow}Found ${commitCount} commits to squash${COLORS.reset}\n`);

    console.log(`${COLORS.blue}Commits to be squashed:${COLORS.reset}`);
    const { stdout: log } = await runCommand(["git", "log", "--oneline", `${mainBranch}..${currentBranch}`], {
      silent: true,
    });
    console.log(log);

    // Handle uncommitted changes
    let stashCreated = false;
    const hasUncommittedChanges = (await git.hasUnstagedChanges()) || (await git.hasStagedChanges());

    if (hasUncommittedChanges) {
      console.log(`\n${COLORS.yellow}You have uncommitted changes${COLORS.reset}`);

      console.log(`\n${COLORS.cyan}Current changes:${COLORS.reset}`);
      await runCommand(["git", "status", "--short"], { silent: false });

      let shouldStash = autoYes;
      if (!autoYes) {
        console.log(`\n${COLORS.yellow}Options:${COLORS.reset}`);
        console.log("  1. Auto-stash changes (recommended) - Changes will be restored after squashing");
        console.log("  2. Abort and handle manually");
        shouldStash = await confirm("\nAuto-stash changes and continue?");
      }

      if (shouldStash) {
        console.log(`\n${COLORS.cyan}Stashing uncommitted changes...${COLORS.reset}`);
        try {
          await runCommand(["git", "stash", "push", "-u", "-m", "smart-git-squash: auto-stash before squashing"], {
            silent: false,
          });
          stashCreated = true;
          logger.success("Changes stashed successfully");
        } catch (e) {
          logger.error("Failed to stash changes");
          if (e instanceof Error) logger.error(e.message);
          process.exit(1);
        }
      } else {
        logger.warn("Aborted by user");
        console.log(`\n${COLORS.cyan}To proceed, you can:${COLORS.reset}`);
        console.log("  - Stash your changes: git stash");
        console.log("  - Commit your changes: git add . && git commit -m 'message'");
        console.log("  - Discard your changes: git reset --hard");
        process.exit(0);
      }
    }

    if (!autoYes) {
      if (!(await confirm(`\nSquash ${commitCount} commits into one?`))) {
        logger.warn("Aborted by user");
        process.exit(0);
      }
    }

    console.log(`\n${COLORS.yellow}Generating AI commit message...${COLORS.reset}`);

    const { stdout: commitsText } = await runCommand(
      ["git", "log", "--format=%s%n%b", `${mainBranch}..${currentBranch}`],
      { silent: true }
    );
    const { stdout: diffText } = await runCommand(["git", "diff", `${mainBranch}...${currentBranch}`], { silent: true });
    const truncatedDiff = diffText.split("\n").slice(0, 500).join("\n");

    const message = await generateSquashMessage(model, commitsText, truncatedDiff);

    console.log(`\n${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.yellow}Generated Commit Message:${COLORS.reset}`);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(message);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);

    const msgFile = join(getProjectRoot(), ".git", "SQUASH_MSG_GENERATED");
    await writeFile(msgFile, message);

    try {
      await performSquash(mainBranch, currentBranch, msgFile, editMessage);
    } catch {
      if (stashCreated) {
        console.log(`\n${COLORS.yellow}Squash failed, restoring stashed changes...${COLORS.reset}`);
        try {
          await runCommand(["git", "stash", "pop"], { silent: false });
          logger.success("Stashed changes restored");
        } catch {
          logger.error("Failed to restore stash");
          console.log(
            `${COLORS.yellow}Your changes are still in the stash. Run 'git stash pop' to restore them.${COLORS.reset}`
          );
        }
      }
      process.exit(1);
    }

    // Restore stashed changes before pushing
    if (stashCreated) {
      console.log(`\n${COLORS.cyan}Restoring stashed changes...${COLORS.reset}`);
      try {
        await runCommand(["git", "stash", "pop"], { silent: false });
        logger.success("Stashed changes restored");
      } catch (e) {
        logger.error("Failed to restore stash automatically");
        console.log(
          `${COLORS.yellow}Your changes are still in the stash. Run 'git stash pop' to restore them.${COLORS.reset}`
        );
        if (e instanceof Error) logger.error(e.message);
      }
    }

    if (!skipPush) {
      console.log(`\n${COLORS.yellow}Pushing to remote...${COLORS.reset}`);
      console.log(`${COLORS.cyan}Using --force-with-lease to safely overwrite remote${COLORS.reset}`);

      try {
        await git.push(currentBranch, true);
        logger.success("Pushed successfully!");
        console.log(`\n${COLORS.green}All done! ${commitCount} commits squashed into one${COLORS.reset}`);
      } catch {
        logger.error("Push failed");
        console.log("You can push manually with: git push --force-with-lease");
        process.exit(1);
      }
    } else {
      logger.success("Commits squashed (push skipped)");
      console.log(`${COLORS.yellow}Push manually with: git push --force-with-lease${COLORS.reset}`);
    }

    console.log(`\n${COLORS.green}Branch is ready for merging!${COLORS.reset}`);
  },
};

export default squashCommand;
