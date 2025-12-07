/**
 * sg rebase - Intelligent git rebasing with conflict handling
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";

import { COLORS, confirm, git, logger, runCommand } from "@/utils/common.ts";
import { getConfig } from "@/utils/config.ts";
import { handleRebaseFailure } from "@/smart-git-rebase/conflict-handler.ts";
import { checkBranchExists, fetchTarget, getCommitCounts } from "@/smart-git-rebase/git-helpers.ts";
import { RebaseArgsSchema } from "@/schemas/cli.ts";

interface RebaseCommandArgs {
  interactive?: boolean;
  onto?: string;
  branch?: string;
  yes?: boolean;
  abortOnConflict?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  dryRun?: boolean;
  noColor?: boolean;
}

const rebaseCommand: CommandModule<object, RebaseCommandArgs> = {
  command: "rebase",
  describe: "Intelligent git rebasing with conflict handling",
  builder: (yargs) => {
    return yargs
      .option("interactive", {
        alias: "i",
        type: "boolean",
        description: "Interactive rebase mode",
        default: false,
      })
      .option("onto", {
        type: "string",
        description: "Rebase onto a specific branch",
      })
      .option("branch", {
        alias: "b",
        type: "string",
        description: "Target branch to rebase against (default: from config)",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        description: "Auto-confirm all prompts",
        default: false,
      })
      .option("abort-on-conflict", {
        type: "boolean",
        description: "Automatically abort on conflict",
        default: false,
      })
      .example("$0 rebase", "Rebase against base branch from config")
      .example("$0 rebase -b development", "Rebase against development")
      .example("$0 rebase -i", "Interactive rebase")
      .example("$0 rebase -y", "Auto-confirm prompts");
  },
  handler: async (argv: ArgumentsCamelCase<RebaseCommandArgs>) => {
    // Validate arguments with Zod
    const args = RebaseArgsSchema.parse(argv);

    const config = getConfig();
    const rebaseMode = args.interactive ? "interactive" : args.onto ? "onto" : "normal";
    const targetBranch = args.onto ?? args.branch ?? config.git.baseBranch;
    const autoYes = args.yes;
    const abortOnConflict = args.abortOnConflict;

    logger.header("Smart Rebase - Intelligent Git Rebasing");

    if (!(await git.isRepo())) {
      logger.error("Not a git repository");
      process.exit(1);
    }

    const currentBranch = await git.getCurrentBranch();
    console.log(`${COLORS.blue}Current branch: ${COLORS.yellow}${currentBranch}${COLORS.reset}`);

    if (currentBranch === targetBranch) {
      logger.error(`Cannot rebase ${targetBranch} onto itself`);
      logger.info("Switch to a feature branch first");
      process.exit(1);
    }

    if ((await git.hasUnstagedChanges()) || (await git.hasStagedChanges())) {
      logger.error("You have uncommitted changes");
      logger.info("Please commit or stash your changes before rebasing");
      await runCommand(["git", "status", "--short"]);
      process.exit(1);
    }

    await fetchTarget(targetBranch);

    if (!(await checkBranchExists(targetBranch))) {
      logger.error(`Branch '${targetBranch}' does not exist`);
      process.exit(1);
    }

    console.log(`\n${COLORS.blue}Branch comparison:${COLORS.reset}`);
    const { ahead, behind } = await getCommitCounts(currentBranch, targetBranch);

    console.log(`  Your branch is ${COLORS.green}${ahead} commit(s) ahead${COLORS.reset} of ${targetBranch}`);
    console.log(`  Your branch is ${COLORS.yellow}${behind} commit(s) behind${COLORS.reset} ${targetBranch}`);

    if (behind === 0) {
      console.log(`\n${COLORS.green}Already up to date with ${targetBranch}${COLORS.reset}`);
      if (rebaseMode !== "interactive") {
        process.exit(0);
      } else {
        console.log(`${COLORS.cyan}Proceeding with interactive rebase to edit commits...${COLORS.reset}`);
      }
    }

    if (ahead > 0) {
      console.log(`\n${COLORS.yellow}Commits to be rebased:${COLORS.reset}`);
      await runCommand(["git", "log", "--oneline", `${targetBranch}..${currentBranch}`]);
    }

    if (behind > 0) {
      console.log(`\n${COLORS.yellow}New commits in ${targetBranch}:${COLORS.reset}`);
      await runCommand(["git", "log", "--oneline", `${currentBranch}..${targetBranch}`, "-n", "10"]);
    }

    if (!autoYes) {
      console.log("");
      const proceed = await confirm("Proceed with rebase?");
      if (!proceed) {
        logger.info("Aborted by user");
        process.exit(0);
      }
    }

    console.log(`\n${COLORS.yellow}Starting rebase...${COLORS.reset}`);

    try {
      if (rebaseMode === "interactive") {
        console.log(`${COLORS.cyan}Opening interactive rebase editor...${COLORS.reset}`);
        console.log(`${COLORS.blue}You can:${COLORS.reset}`);
        console.log("  - pick = use commit");
        console.log("  - reword = use commit, but edit message");
        console.log("  - edit = use commit, but stop for amending");
        console.log("  - squash = meld into previous commit");
        console.log("  - fixup = like squash, but discard commit message");
        console.log("  - drop = remove commit");
        console.log("");

        await runCommand(["git", "rebase", "-i", targetBranch]);
      } else {
        await runCommand(["git", "rebase", targetBranch]);
      }
      console.log(`\n${COLORS.green}Rebase completed successfully!${COLORS.reset}`);
    } catch {
      await handleRebaseFailure(abortOnConflict);
      process.exit(1);
    }

    console.log(`\n${COLORS.blue}Updated branch status:${COLORS.reset}`);
    const { ahead: newAhead } = await getCommitCounts(currentBranch, targetBranch);
    console.log(`  Your branch is now ${COLORS.green}${newAhead} commit(s) ahead${COLORS.reset} of ${targetBranch}`);
    console.log(`  Your branch is now ${COLORS.green}up to date${COLORS.reset} with ${targetBranch}`);

    const upstream = await git.getUpstreamBranch();
    if (upstream) {
      console.log(`\n${COLORS.yellow}Your branch has diverged from its remote${COLORS.reset}`);
      console.log(`${COLORS.cyan}To push the rebased branch, use:${COLORS.reset}`);
      console.log(`  ${COLORS.blue}git push --force-with-lease${COLORS.reset}`);
      console.log("");
      console.log(`${COLORS.cyan}Or run sg push to commit and push automatically:${COLORS.reset}`);
      console.log(`  ${COLORS.blue}sg push --skip-rebase${COLORS.reset}`);
    } else {
      console.log(`\n${COLORS.cyan}Branch has no upstream yet${COLORS.reset}`);
      console.log(`Push with: ${COLORS.blue}git push -u origin ${currentBranch}${COLORS.reset}`);
    }

    console.log(`\n${COLORS.green}Rebase complete!${COLORS.reset}`);
  },
};

export default rebaseCommand;
