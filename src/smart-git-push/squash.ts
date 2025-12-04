/** biome-ignore-all lint/suspicious/noConsole: to show feedback */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateSquashMessage } from "../smart-git-squash/generator.ts";
import { performSquash } from "../smart-git-squash/squash.ts";
import { COLORS, confirm, getProjectRoot, logger, runCommand } from "../utils/common.ts";
import { getModelForComplexity } from "../utils/openrouter.ts";

export const shouldSquash = async (currentBranch: string, baseBranch: string): Promise<number> => {
  // Check if we're on base branch
  if (currentBranch === baseBranch) {
    return 0;
  }

  // Verify base branch exists
  try {
    await runCommand(["git", "rev-parse", "--verify", baseBranch], { silent: true });
  } catch {
    return 0;
  }

  // Count commits to squash
  const { stdout: commitCountStr } = await runCommand(
    ["git", "rev-list", "--count", `${baseBranch}..${currentBranch}`],
    { silent: true }
  );
  return parseInt(commitCountStr.trim(), 10);
};

export const handleSquash = async (
  currentBranch: string,
  baseBranch: string,
  autoYes: boolean,
  commitCount?: number
): Promise<boolean> => {
  // If commit count not provided, calculate it
  if (commitCount === undefined) {
    commitCount = await shouldSquash(currentBranch, baseBranch);
  }

  // Validate conditions
  if (currentBranch === baseBranch) {
    logger.error(`Cannot squash commits on ${baseBranch} branch`);
    console.log("Squashing is only for feature branches.");
    return false;
  }

  if (commitCount === 0) {
    logger.info(`No commits to squash - branch is up to date with ${baseBranch}`);
    return false;
  }

  if (commitCount === 1) {
    return false; // Silently skip if only one commit
  }

  console.log(`\n${COLORS.yellow}📊 Found ${commitCount} commits to squash${COLORS.reset}`);
  console.log(`${COLORS.blue}Commits to be squashed:${COLORS.reset}`);
  const { stdout: log } = await runCommand(["git", "log", "--oneline", `${baseBranch}..${currentBranch}`], {
    silent: true,
  });
  console.log(log);

  if (!autoYes) {
    if (!(await confirm(`\nSquash ${commitCount} commits into one?`))) {
      logger.warn("Squashing skipped by user");
      return false;
    }
  }

  console.log(`\n${COLORS.yellow}🤖 Generating AI commit message for squashed commit...${COLORS.reset}`);

  const model = getModelForComplexity("SMALL");
  const { stdout: commitsText } = await runCommand(
    ["git", "log", "--format=%s%n%b", `${baseBranch}..${currentBranch}`],
    { silent: true }
  );
  const { stdout: diffText } = await runCommand(["git", "diff", `${baseBranch}...${currentBranch}`], { silent: true });

  // Truncate diff if too large
  const truncatedDiff = diffText.split("\n").slice(0, 500).join("\n");

  const message = await generateSquashMessage(model, commitsText, truncatedDiff);

  console.log(`\n${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.yellow}Generated Squash Commit Message:${COLORS.reset}`);
  console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
  console.log(message);
  console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);

  const msgFile = join(getProjectRoot(), ".git", "SQUASH_MSG_GENERATED");
  await writeFile(msgFile, message);

  try {
    await performSquash(baseBranch, currentBranch, msgFile, false);
    return true;
  } catch (e) {
    logger.error("Squashing failed");
    if (e instanceof Error) logger.error(e.message);
    return false;
  }
};
