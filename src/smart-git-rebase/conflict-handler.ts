/** biome-ignore-all lint/suspicious/noConsole: to show feedback */
import { COLORS, logger, runCommand } from "../utils/common.ts";

export const handleRebaseFailure = async (abortOnConflict: boolean): Promise<void> => {
  console.log(`\n${COLORS.red}❌ Rebase failed with conflicts${COLORS.reset}`);

  if (abortOnConflict) {
    logger.warn("Auto-aborting rebase due to --abort-on-conflict flag");
    await runCommand(["git", "rebase", "--abort"]);
    process.exit(1);
  }

  console.log(`\n${COLORS.yellow}📋 Conflicted files:${COLORS.reset}`);
  try {
    await runCommand(["git", "diff", "--name-only", "--diff-filter=U"]);
  } catch {}

  console.log(`\n${COLORS.cyan}To resolve conflicts:${COLORS.reset}`);
  console.log(`  1. ${COLORS.blue}Edit the conflicted files to resolve conflicts${COLORS.reset}`);
  console.log(`  2. ${COLORS.blue}Stage resolved files: ${COLORS.yellow}git add <files>${COLORS.reset}`);
  console.log(`  3. ${COLORS.blue}Continue rebase: ${COLORS.yellow}git rebase --continue${COLORS.reset}`);
  console.log("");
  console.log(`${COLORS.cyan}Or abort the rebase:${COLORS.reset}`);
  console.log(`  ${COLORS.blue}git rebase --abort${COLORS.reset}`);
  console.log("");
  console.log(`${COLORS.cyan}Tips:${COLORS.reset}`);
  console.log(`  - Use ${COLORS.yellow}git status${COLORS.reset} to see which files have conflicts`);
  console.log(
    `  - Look for ${COLORS.yellow}<<<<<<<${COLORS.reset}, ${COLORS.yellow}=======${COLORS.reset}, and ${COLORS.yellow}>>>>>>>${COLORS.reset} markers in files`
  );
  console.log(
    `  - After resolving, use ${COLORS.yellow}git add${COLORS.reset} then ${COLORS.yellow}git rebase --continue${COLORS.reset}`
  );
};
