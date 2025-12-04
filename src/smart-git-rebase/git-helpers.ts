import { logger, runCommand } from "../utils/common.ts";

export const fetchTarget = async (targetBranch: string): Promise<void> => {
  logger.info(`📥 Fetching latest ${targetBranch}...`);
  try {
    await runCommand(["git", "fetch", "origin", `${targetBranch}:${targetBranch}`], { silent: true });
  } catch {
    logger.warn(`⚠️  Could not fetch ${targetBranch} directly, trying alternative...`);
    await runCommand(["git", "fetch", "origin", targetBranch], { silent: true });
  }
};

export const checkBranchExists = async (branch: string): Promise<boolean> => {
  try {
    await runCommand(["git", "rev-parse", "--verify", branch], { silent: true });
    return true;
  } catch {
    return false;
  }
};

export const getCommitCounts = async (current: string, target: string) => {
  const { stdout: ahead } = await runCommand(["git", "rev-list", "--count", `${target}..${current}`], { silent: true });
  const { stdout: behind } = await runCommand(["git", "rev-list", "--count", `${current}..${target}`], {
    silent: true,
  });
  return {
    ahead: parseInt(ahead.trim()) || 0,
    behind: parseInt(behind.trim()) || 0,
  };
};
