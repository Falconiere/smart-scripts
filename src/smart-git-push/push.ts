/** biome-ignore-all lint/suspicious/noConsole: to show feedback */
import { COLORS, confirm, git, logger, runCommand } from "../utils/common.ts";
import { getConfig } from "../utils/config.ts";

/**
 * Check if error is a non-fast-forward rejection
 */
const isNonFastForward = (error: Error): boolean => {
  const msg = error.message.toLowerCase();
  return msg.includes("non-fast-forward") || msg.includes("fetch first") || msg.includes("tip of your current branch is behind");
};

/**
 * Handle non-fast-forward rejection by syncing with remote and retrying
 */
const handleNonFastForward = async (
  currentBranch: string,
  setUpstream: boolean,
  autoYes: boolean
): Promise<boolean> => {
  const config = getConfig();
  const syncStrategy = config.git.syncStrategy !== "none" ? config.git.syncStrategy : "rebase";

  console.log(`\n${COLORS.yellow}⚠️  Push rejected: your branch is behind the remote${COLORS.reset}`);
  console.log(`${COLORS.cyan}Fetching latest changes...${COLORS.reset}`);

  await git.fetch();

  // Show what commits are on remote that we don't have
  try {
    const { stdout: remoteCommits } = await runCommand(
      ["git", "log", `HEAD..origin/${currentBranch}`, "--oneline"],
      { silent: true }
    );

    if (remoteCommits.trim()) {
      const commitCount = remoteCommits.trim().split("\n").length;
      console.log(`\n${COLORS.yellow}Remote has ${commitCount} commit(s) you don't have:${COLORS.reset}`);
      console.log(`${COLORS.dim}${remoteCommits}${COLORS.reset}`);
    }
  } catch {
    // Branch might not exist on remote yet
  }

  // Ask user or auto-proceed
  let shouldSync = autoYes;
  if (!autoYes) {
    console.log(`\n${COLORS.cyan}Recommended: Sync with remote using ${syncStrategy}${COLORS.reset}`);
    shouldSync = await confirm(`\nSync with remote (${syncStrategy}) and retry push?`);
  }

  if (!shouldSync) {
    logger.warn("Push aborted. Run manually: git pull --rebase && git push");
    return false;
  }

  // Sync with remote
  console.log(`\n${COLORS.cyan}Syncing with origin/${currentBranch} (${syncStrategy})...${COLORS.reset}`);

  try {
    if (syncStrategy === "rebase") {
      await runCommand(["git", "rebase", `origin/${currentBranch}`], { silent: false });
    } else {
      await runCommand(["git", "merge", `origin/${currentBranch}`, "--no-edit"], { silent: false });
    }
    logger.success(`Successfully synced with origin/${currentBranch}`);
  } catch {
    logger.error(`${syncStrategy === "rebase" ? "Rebase" : "Merge"} failed with conflicts`);
    console.log(`${COLORS.yellow}Please resolve conflicts manually:${COLORS.reset}`);
    if (syncStrategy === "rebase") {
      console.log("  1. Fix conflicts");
      console.log("  2. git add <files>");
      console.log("  3. git rebase --continue");
      console.log("  4. git push");
    } else {
      console.log("  1. Fix conflicts");
      console.log("  2. git add <files>");
      console.log("  3. git commit");
      console.log("  4. git push");
    }
    return false;
  }

  // Retry push
  console.log(`\n${COLORS.yellow}🚢 Retrying push...${COLORS.reset}`);
  await git.push(currentBranch, false, setUpstream);
  logger.success("Pushed successfully!");
  console.log(`\n${COLORS.green}🎉 All done! Changes synced and pushed to ${currentBranch}${COLORS.reset}`);

  return true;
};

export const performPush = async (
  currentBranch: string,
  useForce: boolean,
  setUpstream: boolean,
  autoYes = false
): Promise<void> => {
  console.log(`\n${COLORS.yellow}🚢 Pushing to remote...${COLORS.reset}`);

  if (useForce) {
    console.log(`${COLORS.cyan}Using --force-with-lease to safely push after rebase${COLORS.reset}`);
  }

  if (setUpstream) {
    console.log(`${COLORS.cyan}Setting upstream to origin/${currentBranch}${COLORS.reset}`);
  }

  try {
    await git.push(currentBranch, useForce, setUpstream);
    logger.success("Pushed successfully!");
    console.log(`\n${COLORS.green}🎉 All done! Changes committed and pushed to ${currentBranch}${COLORS.reset}`);
  } catch (error) {
    // Check if this is a non-fast-forward rejection (branch behind remote)
    if (!useForce && error instanceof Error && isNonFastForward(error)) {
      const handled = await handleNonFastForward(currentBranch, setUpstream, autoYes);
      if (!handled) {
        throw new Error("Push failed: branch is behind remote");
      }
      return;
    }

    // Check if this is a force-with-lease failure due to stale info
    if (useForce && error instanceof Error && (error.message.includes("stale info") || (error as any).isStaleInfo)) {
      console.log(`\n${COLORS.yellow}⚠️  Force-with-lease failed: remote branch has been updated${COLORS.reset}`);
      console.log(`${COLORS.cyan}Fetching latest changes to update tracking info...${COLORS.reset}`);

      // Fetch to update remote tracking - ignore error if branch doesn't exist remotely yet
      let remoteBranchExists = true;
      try {
        await runCommand(["git", "fetch", "origin", currentBranch], { silent: false });
      } catch (fetchError) {
        // If branch doesn't exist on remote, that's fine - just continue
        if (fetchError instanceof Error && fetchError.message.includes("couldn't find remote ref")) {
          console.log(`${COLORS.cyan}Remote branch doesn't exist (may have been deleted remotely).${COLORS.reset}`);
          remoteBranchExists = false;
        } else {
          throw fetchError;
        }
      }

      if (remoteBranchExists) {
        console.log(`\n${COLORS.yellow}📊 Checking remote changes...${COLORS.reset}`);
        try {
          const { stdout } = await runCommand(["git", "log", "HEAD..origin/" + currentBranch, "--oneline"], {
            silent: true,
          });

          if (stdout.trim()) {
            console.log(`${COLORS.red}⚠️  Remote has new commits that you don't have locally:${COLORS.reset}`);
            console.log(stdout);
            console.log(`\n${COLORS.yellow}Your local changes would overwrite these remote commits.${COLORS.reset}`);
          } else {
            console.log(`${COLORS.cyan}Remote tracking info updated. No conflicting commits found.${COLORS.reset}`);
          }
        } catch {
          // If we can't compare, just continue
        }
      } else {
        console.log(`${COLORS.cyan}Since remote branch doesn't exist, pushing as a new branch...${COLORS.reset}`);
        // Just push with set-upstream, no force needed
        await git.push(currentBranch, false, true);
        logger.success("Pushed successfully!");
        console.log(`\n${COLORS.green}🎉 All done! Changes pushed to ${currentBranch}${COLORS.reset}`);
        return;
      }

      let shouldForcePush = autoYes;
      if (!autoYes) {
        console.log(`\n${COLORS.yellow}Options:${COLORS.reset}`);
        console.log(`  1. Force push anyway (will overwrite remote)`);
        console.log(`  2. Pull and rebase first (safer, but requires manual conflict resolution)`);
        console.log(`  3. Abort`);

        shouldForcePush = await confirm("\nForce push anyway?");
      }

      if (shouldForcePush) {
        console.log(`${COLORS.cyan}Force pushing...${COLORS.reset}`);
        await git.push(currentBranch, true, setUpstream, true); // true for --force
        logger.success("Pushed successfully!");
        console.log(`\n${COLORS.green}🎉 All done! Changes force pushed to ${currentBranch}${COLORS.reset}`);
      } else {
        logger.warn("Push aborted. You can manually pull and rebase, or run the script again.");
        throw new Error("Push cancelled by user");
      }
    } else {
      // Re-throw other errors
      throw error;
    }
  }
};
