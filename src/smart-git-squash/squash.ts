/** biome-ignore-all lint/suspicious/noConsole: to show feedback */
import { COLORS, logger, runCommand } from "../utils/common.ts";

export const performSquash = async (
  mainBranch: string,
  currentBranch: string,
  messageFile: string,
  editMessage: boolean
): Promise<void> => {
  console.log(`\n${COLORS.yellow}🔄 Squashing commits...${COLORS.reset}`);

  try {
    await runCommand(["git", "reset", "--soft", mainBranch]);
    logger.success("Commits squashed (staged)");
  } catch {
    logger.error("Failed to squash commits");
    throw new Error("Squash failed");
  }

  console.log(`\n${COLORS.yellow}💾 Creating squashed commit...${COLORS.reset}`);

  try {
    const flags = ["-F", messageFile];
    if (editMessage) flags.unshift("-e");

    await runCommand(["git", "commit", ...flags], { silent: false });
    logger.success("Squashed commit created successfully!");
  } catch {
    logger.error("Commit failed");
    throw new Error("Commit failed");
  }

  console.log(`\n${COLORS.blue}New commit:${COLORS.reset}`);
  const { stdout: newLog } = await runCommand(
    ["git", "log", "-1", "--pretty=format:%C(yellow)%h%C(reset) - %s", "--stat"],
    { silent: true }
  );
  console.log(newLog);
};
