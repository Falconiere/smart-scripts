/**
 * sg status - Smart git status with branch comparison
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";

import { COLORS, git, logger, runCommand } from "@/utils/common.ts";
import { getConfig } from "@/utils/config.ts";
import { StatusArgsSchema } from "@/schemas/cli.ts";

interface StatusCommandArgs {
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  checkPr?: boolean;
}

interface StatusInfo {
  branch: {
    current: string;
    base: string;
    upstream: string | null;
  };
  sync: {
    aheadOfBase: number;
    behindBase: number;
    aheadOfUpstream: number;
    behindUpstream: number;
    localBaseBehind: number;
    localBaseAhead: number;
  };
  workingTree: {
    staged: number;
    unstaged: number;
    untracked: number;
    conflicts: number;
  };
  pr: {
    exists: boolean;
    url: string | null;
    state: string | null;
    draft: boolean;
  } | null;
}

const getCommitCount = async (from: string, to: string): Promise<number> => {
  try {
    const { stdout } = await runCommand(["git", "rev-list", "--count", `${from}..${to}`], { silent: true });
    return Number.parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
};

const getFileCount = async (args: string[]): Promise<number> => {
  try {
    const { stdout } = await runCommand(["git", "diff", "--name-only", ...args], { silent: true });
    return stdout.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

const getUntrackedCount = async (): Promise<number> => {
  try {
    const { stdout } = await runCommand(["git", "ls-files", "--others", "--exclude-standard"], { silent: true });
    return stdout.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

const getConflictCount = async (): Promise<number> => {
  try {
    const { stdout } = await runCommand(["git", "status", "--porcelain"], { silent: true });
    return stdout.split("\n").filter((line) => line.startsWith("UU") || line.startsWith("AA") || line.startsWith("DD"))
      .length;
  } catch {
    return 0;
  }
};

const getPrInfo = async (
  currentBranch: string
): Promise<{ exists: boolean; url: string | null; state: string | null; draft: boolean }> => {
  try {
    const { stdout, exitCode } = await runCommand(
      ["gh", "pr", "view", currentBranch, "--json", "url,state,isDraft"],
      { silent: true, ignoreExitCode: true }
    );

    if (exitCode !== 0 || !stdout.trim()) {
      return { exists: false, url: null, state: null, draft: false };
    }

    const pr = JSON.parse(stdout);
    return {
      exists: true,
      url: pr.url,
      state: pr.state,
      draft: pr.isDraft ?? false,
    };
  } catch {
    return { exists: false, url: null, state: null, draft: false };
  }
};

const collectStatus = async (baseBranch: string, checkPr: boolean): Promise<StatusInfo> => {
  const currentBranch = await git.getCurrentBranch();
  const upstream = await git.getUpstreamBranch();

  // Fetch to get latest remote state
  await git.fetch();

  // Calculate sync status with base branch
  const aheadOfBase = await getCommitCount(`origin/${baseBranch}`, "HEAD");
  const behindBase = await getCommitCount("HEAD", `origin/${baseBranch}`);

  // Calculate local base branch status
  let localBaseBehind = 0;
  let localBaseAhead = 0;
  try {
    await runCommand(["git", "rev-parse", "--verify", baseBranch], { silent: true });
    localBaseBehind = await getCommitCount(baseBranch, `origin/${baseBranch}`);
    localBaseAhead = await getCommitCount(`origin/${baseBranch}`, baseBranch);
  } catch {
    // Local base branch doesn't exist
  }

  // Calculate upstream status
  let aheadOfUpstream = 0;
  let behindUpstream = 0;
  if (upstream) {
    aheadOfUpstream = await getCommitCount(upstream, "HEAD");
    behindUpstream = await getCommitCount("HEAD", upstream);
  }

  // Working tree status
  const staged = await getFileCount(["--cached"]);
  const unstaged = await getFileCount([]);
  const untracked = await getUntrackedCount();
  const conflicts = await getConflictCount();

  // PR status
  let pr = null;
  if (checkPr) {
    pr = await getPrInfo(currentBranch);
  }

  return {
    branch: {
      current: currentBranch,
      base: baseBranch,
      upstream,
    },
    sync: {
      aheadOfBase,
      behindBase,
      aheadOfUpstream,
      behindUpstream,
      localBaseBehind,
      localBaseAhead,
    },
    workingTree: {
      staged,
      unstaged,
      untracked,
      conflicts,
    },
    pr,
  };
};

const formatSyncIndicator = (ahead: number, behind: number): string => {
  if (ahead === 0 && behind === 0) {
    return `${COLORS.green}✓ up to date${COLORS.reset}`;
  }

  const parts: string[] = [];
  if (ahead > 0) {
    parts.push(`${COLORS.green}↑${ahead}${COLORS.reset}`);
  }
  if (behind > 0) {
    parts.push(`${COLORS.yellow}↓${behind}${COLORS.reset}`);
  }
  return parts.join(" ");
};

const printStatus = (status: StatusInfo): void => {
  const { branch, sync, workingTree, pr } = status;

  // Header
  console.log("");
  console.log(`${COLORS.bold}${COLORS.cyan}Branch Status${COLORS.reset}`);
  console.log(`${COLORS.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);

  // Current branch
  console.log(`  ${COLORS.bold}On branch:${COLORS.reset}  ${COLORS.yellow}${branch.current}${COLORS.reset}`);

  // Upstream tracking
  if (branch.upstream) {
    console.log(`  ${COLORS.bold}Tracking:${COLORS.reset}   ${branch.upstream} ${formatSyncIndicator(sync.aheadOfUpstream, sync.behindUpstream)}`);
  } else {
    console.log(`  ${COLORS.bold}Tracking:${COLORS.reset}   ${COLORS.dim}(no upstream)${COLORS.reset}`);
  }

  // Base branch comparison
  console.log("");
  console.log(`${COLORS.bold}${COLORS.cyan}Base Branch (${branch.base})${COLORS.reset}`);
  console.log(`${COLORS.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log(`  ${COLORS.bold}vs origin/${branch.base}:${COLORS.reset} ${formatSyncIndicator(sync.aheadOfBase, sync.behindBase)}`);

  // Local base branch status
  if (sync.localBaseBehind > 0 || sync.localBaseAhead > 0) {
    const localStatus =
      sync.localBaseAhead > 0
        ? `${COLORS.yellow}⚠ has ${sync.localBaseAhead} unpushed commit(s)${COLORS.reset}`
        : `${COLORS.cyan}↓ ${sync.localBaseBehind} commit(s) behind remote${COLORS.reset}`;
    console.log(`  ${COLORS.bold}Local ${branch.base}:${COLORS.reset}    ${localStatus}`);
  } else {
    console.log(`  ${COLORS.bold}Local ${branch.base}:${COLORS.reset}    ${COLORS.green}✓ up to date${COLORS.reset}`);
  }

  // Working tree
  console.log("");
  console.log(`${COLORS.bold}${COLORS.cyan}Working Tree${COLORS.reset}`);
  console.log(`${COLORS.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);

  const hasChanges = workingTree.staged > 0 || workingTree.unstaged > 0 || workingTree.untracked > 0;

  if (workingTree.conflicts > 0) {
    console.log(`  ${COLORS.red}✖ ${workingTree.conflicts} conflict(s)${COLORS.reset}`);
  }

  if (hasChanges) {
    if (workingTree.staged > 0) {
      console.log(`  ${COLORS.green}● ${workingTree.staged} staged${COLORS.reset}`);
    }
    if (workingTree.unstaged > 0) {
      console.log(`  ${COLORS.yellow}○ ${workingTree.unstaged} modified${COLORS.reset}`);
    }
    if (workingTree.untracked > 0) {
      console.log(`  ${COLORS.dim}? ${workingTree.untracked} untracked${COLORS.reset}`);
    }
  } else {
    console.log(`  ${COLORS.green}✓ clean${COLORS.reset}`);
  }

  // PR status
  if (pr !== null) {
    console.log("");
    console.log(`${COLORS.bold}${COLORS.cyan}Pull Request${COLORS.reset}`);
    console.log(`${COLORS.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);

    if (pr.exists) {
      const stateColor = pr.state === "OPEN" ? COLORS.green : pr.state === "MERGED" ? COLORS.magenta : COLORS.red;
      const draftLabel = pr.draft ? ` ${COLORS.dim}(draft)${COLORS.reset}` : "";
      console.log(`  ${COLORS.bold}Status:${COLORS.reset}     ${stateColor}${pr.state}${COLORS.reset}${draftLabel}`);
      console.log(`  ${COLORS.bold}URL:${COLORS.reset}        ${COLORS.blue}${pr.url}${COLORS.reset}`);
    } else {
      console.log(`  ${COLORS.dim}No PR found for this branch${COLORS.reset}`);
    }
  }

  // Suggestions
  const suggestions: string[] = [];

  if (sync.behindBase > 0) {
    suggestions.push(`Run ${COLORS.cyan}sg rebase${COLORS.reset} to sync with ${branch.base}`);
  }
  if (sync.localBaseBehind > 0 && sync.localBaseAhead === 0) {
    suggestions.push(`Local ${branch.base} can be updated with ${COLORS.cyan}sg push${COLORS.reset} (auto-sync)`);
  }
  if (hasChanges && workingTree.staged === 0) {
    suggestions.push(`Stage and commit with ${COLORS.cyan}sg push${COLORS.reset} or ${COLORS.cyan}sg commit${COLORS.reset}`);
  }
  if (workingTree.staged > 0) {
    suggestions.push(`Commit staged changes with ${COLORS.cyan}sg commit${COLORS.reset}`);
  }
  if (sync.aheadOfUpstream > 0) {
    suggestions.push(`Push changes with ${COLORS.cyan}sg push${COLORS.reset}`);
  }
  if (pr === null) {
    suggestions.push(`Check PR status with ${COLORS.cyan}sg status --check-pr${COLORS.reset}`);
  } else if (!pr.exists && sync.aheadOfBase > 0) {
    suggestions.push(`Create a PR with ${COLORS.cyan}sg push${COLORS.reset}`);
  }

  if (suggestions.length > 0) {
    console.log("");
    console.log(`${COLORS.bold}${COLORS.cyan}Suggestions${COLORS.reset}`);
    console.log(`${COLORS.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
    for (const suggestion of suggestions) {
      console.log(`  → ${suggestion}`);
    }
  }

  console.log("");
};

const statusCommand: CommandModule<object, StatusCommandArgs> = {
  command: "status",
  describe: "Smart git status with branch comparison",
  builder: (yargs) => {
    return yargs
      .option("check-pr", {
        type: "boolean",
        description: "Check PR status (requires gh CLI)",
        default: false,
      })
      .example("$0 status", "Show branch and working tree status")
      .example("$0 status --check-pr", "Include PR status")
      .example("$0 status --json", "Output as JSON");
  },
  handler: async (argv: ArgumentsCamelCase<StatusCommandArgs>) => {
    const args = StatusArgsSchema.parse(argv);

    if (!(await git.isRepo())) {
      logger.error("Not a git repository");
      process.exit(1);
    }

    const config = getConfig();
    const baseBranch = config.git.baseBranch;

    const status = await collectStatus(baseBranch, args.checkPr ?? false);

    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      printStatus(status);
    }
  },
};

export default statusCommand;
