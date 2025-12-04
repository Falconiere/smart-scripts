/** biome-ignore-all lint/suspicious/noConsole: to show feedback */
import { COLORS, git, logger, runCommand } from "../utils/common.ts";

export const performRebase = async (currentBranch: string, baseBranch: string): Promise<void> => {
  if (currentBranch === baseBranch) {
    return; // Don't rebase branch onto itself
  }

  console.log(`\n${COLORS.yellow}🔄 Rebasing from ${baseBranch}...${COLORS.reset}`);

  try {
    console.log(`${COLORS.cyan}Fetching latest ${baseBranch}...${COLORS.reset}`);
    await runCommand(["git", "fetch", "origin", baseBranch]);

    // Update local base branch if possible (fast-forward only)
    const localUpdateResult = await git.updateLocalBaseBranch(baseBranch);
    if (localUpdateResult.updated) {
      console.log(`${COLORS.cyan}📥 ${localUpdateResult.message}${COLORS.reset}`);
    } else if (localUpdateResult.message.includes("unpushed")) {
      console.log(`${COLORS.yellow}⚠️  ${localUpdateResult.message}${COLORS.reset}`);
    }

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
