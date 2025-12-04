/** biome-ignore-all lint/suspicious/noConsole: to show feedback */
import { COLORS, git, logger, runCommand } from "../utils/common.ts";

export const stageChanges = async (mode: string): Promise<void> => {
  const hasStaged = await git.hasStagedChanges();

  if (hasStaged) {
    console.log(`\n${COLORS.green}✓ Using existing staged changes${COLORS.reset}`);
    return;
  }

  console.log(`\n${COLORS.yellow}📦 Staging changes (mode: ${mode})...${COLORS.reset}`);

  if (mode === "all") {
    await git.stageAll();
    logger.success("Staged all changes");
  } else if (mode === "tracked") {
    await git.stageTracked();
    logger.success("Staged tracked files");
  } else if (mode === "interactive") {
    console.log(`${COLORS.cyan}Opening interactive staging...${COLORS.reset}`);
    await runCommand(["git", "add", "-i"], { silent: false });
  }
};
