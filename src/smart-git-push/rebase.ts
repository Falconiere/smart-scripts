/** biome-ignore-all lint/suspicious/noConsole: to show feedback */
import { COLORS, logger, runCommand } from "../utils/common.ts";

const updateLocalBaseBranch = async (baseBranch: string, currentBranch: string): Promise<void> => {
  // Check if local base branch exists
  try {
    await runCommand(["git", "rev-parse", "--verify", baseBranch], { silent: true });
  } catch {
    // Local base branch doesn't exist, skip update
    return;
  }

  // Don't try to update if we're on the base branch (handled earlier)
  if (currentBranch === baseBranch) {
    return;
  }

  // Check if local base branch can be fast-forwarded
  try {
    const { stdout: behindCount } = await runCommand(
      ["git", "rev-list", "--count", `${baseBranch}..origin/${baseBranch}`],
      { silent: true }
    );

    const { stdout: aheadCount } = await runCommand(
      ["git", "rev-list", "--count", `origin/${baseBranch}..${baseBranch}`],
      { silent: true }
    );

    const behind = Number.parseInt(behindCount.trim(), 10);
    const ahead = Number.parseInt(aheadCount.trim(), 10);

    if (behind > 0 && ahead === 0) {
      // Local base branch is behind remote and has no local commits - safe to fast-forward
      console.log(
        `${COLORS.cyan}📥 Updating local ${baseBranch} branch (${behind} commit(s) behind)...${COLORS.reset}`
      );
      await runCommand(["git", "fetch", "origin", `${baseBranch}:${baseBranch}`], { silent: true });
      logger.success(`Local ${baseBranch} branch updated`);
    } else if (behind > 0 && ahead > 0) {
      // Local base branch has diverged - warn but don't update
      console.log(
        `${COLORS.yellow}⚠️  Local ${baseBranch} has ${ahead} unpushed commit(s), skipping update${COLORS.reset}`
      );
    }
    // else: local is up to date or ahead, no action needed
  } catch {
    // If anything goes wrong, just skip the local update and continue with remote rebase
    console.log(`${COLORS.dim}Could not update local ${baseBranch}, will rebase from remote${COLORS.reset}`);
  }
};

export const performRebase = async (currentBranch: string, baseBranch: string): Promise<void> => {
  if (currentBranch === baseBranch) {
    return; // Don't rebase branch onto itself
  }

  console.log(`\n${COLORS.yellow}🔄 Rebasing from ${baseBranch}...${COLORS.reset}`);

  try {
    console.log(`${COLORS.cyan}Fetching latest ${baseBranch}...${COLORS.reset}`);
    await runCommand(["git", "fetch", "origin", baseBranch]);

    // Update local base branch if possible
    await updateLocalBaseBranch(baseBranch, currentBranch);

    const { stdout: count } = await runCommand(["git", "rev-list", `HEAD..origin/${baseBranch}`, "--count"], {
      silent: true,
    });

    if (Number.parseInt(count) > 0) {
      console.log(`${COLORS.cyan}Found ${count} new commit(s) in ${baseBranch}, rebasing...${COLORS.reset}`);
      await runCommand(["git", "rebase", `origin/${baseBranch}`]);
      logger.success(`Successfully rebased from ${baseBranch}`);
    } else {
      logger.success(`Already up to date with ${baseBranch}`);
    }
  } catch (e) {
    logger.error("Rebase failed with conflicts");
    console.log(`${COLORS.yellow}Please resolve conflicts manually:${COLORS.reset}`);
    console.log("  1. Fix conflicts");
    console.log("  2. git add <files>");
    console.log("  3. git rebase --continue");
    if (e instanceof Error) logger.error(e.message);
    throw e;
  }
};
