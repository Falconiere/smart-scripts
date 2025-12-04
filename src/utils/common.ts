/** biome-ignore-all lint/suspicious/noConsole: to show feedback */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

// --- Colors & Logging ---

export const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export const colorize = (color: keyof typeof COLORS, text: string): string => `${COLORS[color]}${text}${COLORS.reset}`;

export const logger = {
  info: (msg: string) => console.log(msg),
  success: (msg: string) => console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`),
  warn: (msg: string) => console.log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`),
  error: (msg: string) => console.error(`${COLORS.red}✖${COLORS.reset} ${msg}`),
  step: (step: number | string, msg: string) => console.log(`${COLORS.blue}[${step}]${COLORS.reset} ${msg}`),
  header: (msg: string) => {
    console.log("");
    console.log(`${COLORS.bold}${COLORS.cyan}${msg}${COLORS.reset}`);
    console.log(`${COLORS.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
    console.log("");
  },
};

// --- User Interaction ---

export const confirm = async (question: string): Promise<boolean> => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${COLORS.yellow}${question} [y/N] ${COLORS.reset}`, (answer) => {
      rl.close();
      const input = answer.trim().toLowerCase();
      resolve(input === "y" || input === "yes");
    });
  });
};

// --- System & Git ---

export const getProjectRoot = (): string => {
  return process.env.PROJECT_ROOT ?? process.cwd();
};

export const requireEnv = (key: string, instructions?: string): string => {
  const value = process.env[key];
  if (!value) {
    logger.error(`Missing environment variable: ${key}`);
    if (instructions) console.log(instructions);
    process.exit(1);
  }
  return value;
};

export const runCommand = async (
  cmd: string[],
  options: { cwd?: string; silent?: boolean; ignoreExitCode?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  return new Promise((resolve, reject) => {
    const [command, ...args] = cmd;

    // Disable git pager for all git commands to prevent vim/less from opening
    const env = { ...process.env };
    if (command === "git") {
      env.GIT_PAGER = "cat";
      env.GIT_TERMINAL_PROMPT = "0";
    }

    // Always pipe stderr to capture error messages, but only pipe stdout if silent
    const proc = spawn(command, args, {
      cwd: options.cwd ?? getProjectRoot(),
      stdio: options.silent ? ["inherit", "pipe", "pipe"] : ["inherit", "inherit", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";

    if (options.silent && proc.stdout) {
      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }

    // Always capture stderr for error detection
    if (proc.stderr) {
      proc.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        // If not silent, also print stderr in real-time
        if (!options.silent) {
          process.stderr.write(text);
        }
      });
    }

    proc.on("close", (exitCode) => {
      const code = exitCode ?? 0;
      if (code !== 0 && !options.ignoreExitCode) {
        reject(new Error(`Command failed with exit code ${code}: ${cmd.join(" ")}\n${stderr}`));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
};

export const git = {
  async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await runCommand(["git", "rev-parse", "--abbrev-ref", "HEAD"], { silent: true });
      return stdout.trim();
    } catch {
      // For repos with no commits yet, try to get branch from symbolic-ref
      try {
        const { stdout } = await runCommand(["git", "symbolic-ref", "--short", "HEAD"], { silent: true });
        return stdout.trim();
      } catch {
        return "main"; // Default fallback
      }
    }
  },

  async getUpstreamBranch(): Promise<string | null> {
    try {
      const { stdout } = await runCommand(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
        silent: true,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  },

  async isRepo(): Promise<boolean> {
    try {
      await runCommand(["git", "rev-parse", "--is-inside-work-tree"], { silent: true });
      return true;
    } catch {
      return false;
    }
  },

  async hasStagedChanges(): Promise<boolean> {
    const { exitCode } = await runCommand(["git", "diff", "--cached", "--quiet"], {
      silent: true,
      ignoreExitCode: true,
    });
    return exitCode === 1;
  },

  async hasUnstagedChanges(): Promise<boolean> {
    const { exitCode } = await runCommand(["git", "diff", "--quiet"], { silent: true, ignoreExitCode: true });
    return exitCode === 1;
  },

  async hasUntrackedFiles(): Promise<boolean> {
    const { stdout } = await runCommand(["git", "ls-files", "--others", "--exclude-standard"], { silent: true });
    return stdout.length > 0;
  },

  async stageAll() {
    await runCommand(["git", "add", "-A"]);
  },

  async stageTracked() {
    await runCommand(["git", "add", "-u"]);
  },

  async commit(message: string, flags: string[] = []) {
    // Write message to file to handle multiline safely
    const msgFile = path.join(getProjectRoot(), ".git", "COMMIT_MSG_TEMP");
    await writeFile(msgFile, message, "utf-8");
    await runCommand(["git", "commit", "-F", msgFile, ...flags]);
  },

  async push(branch: string, forceWithLease = false, setUpstream = false, force = false) {
    const args = ["push"];
    if (setUpstream) args.push("-u", "origin", branch);
    if (force) {
      args.push("--force");
    } else if (forceWithLease) {
      args.push("--force-with-lease");
    }
    if (!setUpstream && !forceWithLease && !force) args.push("origin", branch);

    try {
      await runCommand(["git", ...args]);
    } catch (error) {
      // Enhance error to include stale info flag for detection
      if (error instanceof Error && error.message.includes("stale info")) {
        const enhancedError = new Error(error.message);
        (enhancedError as any).isStaleInfo = true;
        throw enhancedError;
      }
      throw error;
    }
  },

  async getStagedDiff(): Promise<string> {
    const { stdout } = await runCommand(["git", "diff", "--cached", "--unified=3"], { silent: true });
    return stdout;
  },

  async getStagedDiffStat(): Promise<string> {
    const { stdout } = await runCommand(["git", "diff", "--cached", "--stat"], { silent: true });
    return stdout;
  },

  async getRecentCommits(limit = 10): Promise<string> {
    try {
      const { stdout } = await runCommand(["git", "log", `-${limit}`, "--pretty=format:- %s"], { silent: true });
      return stdout;
    } catch {
      // No commits yet
      return "";
    }
  },

  /**
   * Fetch latest changes from remote
   */
  async fetch(): Promise<void> {
    await runCommand(["git", "fetch", "origin"], { silent: true });
  },

  /**
   * Check if branch needs to sync with base branch
   */
  async needsSync(baseBranch: string): Promise<boolean> {
    try {
      await this.fetch();
      const { stdout } = await runCommand(
        ["git", "rev-list", "--count", `HEAD..origin/${baseBranch}`],
        { silent: true }
      );
      return parseInt(stdout.trim(), 10) > 0;
    } catch {
      return false;
    }
  },

  /**
   * Check if working tree has any changes (staged, unstaged, or untracked)
   */
  async hasAnyChanges(): Promise<boolean> {
    const hasStaged = await this.hasStagedChanges();
    const hasUnstaged = await this.hasUnstagedChanges();
    const hasUntracked = await this.hasUntrackedFiles();
    return hasStaged || hasUnstaged || hasUntracked;
  },

  /**
   * Stash all changes including untracked files
   * Returns true if something was stashed, and the list of files that were staged
   */
  async stashChanges(): Promise<{ stashed: boolean; stagedFiles: string[] }> {
    const hasChanges = await this.hasAnyChanges();
    if (!hasChanges) {
      return { stashed: false, stagedFiles: [] };
    }

    // Capture staged files before stashing to restore staging state later
    const { stdout: stagedFilesOutput } = await runCommand(
      ["git", "diff", "--name-only", "--cached"],
      { silent: true }
    );
    const stagedFiles = stagedFilesOutput.split("\n").filter(Boolean);

    await runCommand(["git", "stash", "push", "-u", "-m", "sg-auto-stash"], { silent: true });
    return { stashed: true, stagedFiles };
  },

  /**
   * Pop the most recent stash and restore staging state
   * @param stagedFiles - List of files that were staged before stashing (for fallback restoration)
   */
  async stashPop(stagedFiles: string[] = []): Promise<{ success: boolean; message: string }> {
    try {
      // Use --index to restore staging state (works if stash has staged changes)
      try {
        await runCommand(["git", "stash", "pop", "--index"], { silent: true });
        return { success: true, message: "Changes restored from stash" };
      } catch (indexError) {
        // If --index fails (e.g., stash doesn't have staged changes), try without --index
        // and manually restore staging state
        await runCommand(["git", "stash", "pop"], { silent: true });

        // Restore staging state for files that were originally staged
        if (stagedFiles.length > 0) {
          // Check which files still exist and can be staged
          const existingFiles: string[] = [];
          for (const file of stagedFiles) {
            try {
              const { exitCode } = await runCommand(["git", "ls-files", "--error-unmatch", file], {
                silent: true,
                ignoreExitCode: true,
              });
              if (exitCode === 0) {
                existingFiles.push(file);
              }
            } catch {
              // File doesn't exist or isn't tracked, skip it
            }
          }

          if (existingFiles.length > 0) {
            await runCommand(["git", "add", ...existingFiles], { silent: true });
          }
        }

        return { success: true, message: "Changes restored from stash" };
      }
    } catch (error) {
      // Check for conflicts during stash pop
      const { stdout: status } = await runCommand(["git", "status", "--porcelain"], { silent: true });
      const hasConflicts = status.includes("UU") || status.includes("AA") || status.includes("DD");

      if (hasConflicts) {
        return {
          success: false,
          message: "Conflicts when restoring changes. Your changes are still in stash.",
        };
      }

      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed to restore stash",
      };
    }
  },

  /**
   * Sync with base branch using specified strategy
   * Automatically stashes and restores local changes
   * Returns true if sync was successful, false if there were conflicts
   */
  async syncWithBase(
    baseBranch: string,
    strategy: "rebase" | "merge"
  ): Promise<{ success: boolean; message: string }> {
    const currentBranch = await this.getCurrentBranch();

    // Don't sync if we're on the base branch
    if (currentBranch === baseBranch) {
      return { success: true, message: "Already on base branch" };
    }

    // Stash any local changes first (capture staged files to restore later)
    const stashResult = await this.stashChanges();
    if (stashResult.stashed) {
      logger.info("Stashed local changes");
    }

    try {
      // Fetch latest
      await this.fetch();

      if (strategy === "rebase") {
        await runCommand(["git", "rebase", `origin/${baseBranch}`], { silent: true });
      } else {
        await runCommand(["git", "merge", `origin/${baseBranch}`, "--no-edit"], { silent: true });
      }

      // Restore stashed changes if we had any (pass staged files to preserve staging state)
      if (stashResult.stashed) {
        const popResult = await this.stashPop(stashResult.stagedFiles);
        if (!popResult.success) {
          return {
            success: false,
            message: `${strategy === "rebase" ? "Rebased" : "Merged"} successfully, but ${popResult.message}`,
          };
        }
        logger.info("Restored local changes");
      }

      return {
        success: true,
        message: `${strategy === "rebase" ? "Rebased onto" : "Merged"} origin/${baseBranch}`,
      };
    } catch (error) {
      // Check for conflicts
      const { stdout: status } = await runCommand(["git", "status", "--porcelain"], { silent: true });
      const hasConflicts = status.includes("UU") || status.includes("AA") || status.includes("DD");

      if (hasConflicts) {
        // Abort the failed operation
        if (strategy === "rebase") {
          await runCommand(["git", "rebase", "--abort"], { silent: true, ignoreExitCode: true });
        } else {
          await runCommand(["git", "merge", "--abort"], { silent: true, ignoreExitCode: true });
        }

        // Restore stashed changes
        if (stashResult.stashed) {
          await this.stashPop(stashResult.stagedFiles);
          logger.info("Restored local changes");
        }

        return {
          success: false,
          message: `Conflicts detected during ${strategy}. Please resolve manually with: git ${strategy} origin/${baseBranch}`,
        };
      }

      // Restore stashed changes on other errors too
      if (stashResult.stashed) {
        await this.stashPop(stashResult.stagedFiles);
      }

      return {
        success: false,
        message: error instanceof Error ? error.message : "Sync failed",
      };
    }
  },
};

/**
 * Ensure .cache directory is in .gitignore
 * Silently adds it if missing, does nothing if already present
 */
export const ensureCacheIgnored = async (): Promise<void> => {
  const root = getProjectRoot();
  const gitignorePath = path.join(root, ".gitignore");

  // Only run in git repos
  if (!existsSync(path.join(root, ".git"))) {
    return;
  }

  try {
    let content = "";
    if (existsSync(gitignorePath)) {
      content = await readFile(gitignorePath, "utf-8");
    }

    // Check if .cache is already ignored (handles .cache, .cache/, .cache/*)
    const lines = content.split("\n").map((l) => l.trim());
    const hasCache = lines.some((line) => line === ".cache" || line === ".cache/" || line.startsWith(".cache/"));

    if (!hasCache) {
      const separator = content.endsWith("\n") || content === "" ? "" : "\n";
      const section = content === "" ? ".cache/\n" : `${separator}\n# Cache files\n.cache/\n`;
      await writeFile(gitignorePath, content + section, "utf-8");
    }
  } catch {
    // Silently ignore errors - this is a convenience feature
  }
};

export const getChangedFiles = async (baseBranch = "development"): Promise<string[]> => {
  try {
    // Uncommitted changes
    const statusCmd = await runCommand(["git", "status", "--porcelain"], { silent: true });
    const _uncommitted = statusCmd.stdout.length > 0;

    const files = new Set<string>();

    // 1. Changes compared to base branch
    try {
      const diffCmd = await runCommand(["git", "diff", "--name-only", `${baseBranch}...HEAD`], { silent: true });
      diffCmd.stdout
        .split("\n")
        .filter(Boolean)
        .forEach((f) => files.add(f));
    } catch {
      logger.warn(`Could not diff against ${baseBranch}.`);
    }

    // 2. Staged changes
    const diffStaged = await runCommand(["git", "diff", "--name-only", "--cached"], { silent: true });
    diffStaged.stdout
      .split("\n")
      .filter(Boolean)
      .forEach((f) => files.add(f));

    const diffUnstaged = await runCommand(["git", "ls-files", "--others", "--exclude-standard"], { silent: true });
    diffUnstaged.stdout
      .split("\n")
      .filter(Boolean)
      .forEach((f) => files.add(f));

    const diffModified = await runCommand(["git", "diff", "--name-only"], { silent: true });
    diffModified.stdout
      .split("\n")
      .filter(Boolean)
      .forEach((f) => files.add(f));

    return Array.from(files).sort();
  } catch {
    logger.warn("Not a git repository or git command failed.");
    return [];
  }
};

// --- Workspace ---

export interface Workspace {
  name: string;
  path: string;
  absolutePath: string;
  packageJson: any;
}

export const getWorkspaces = async (): Promise<Workspace[]> => {
  const root = getProjectRoot();
  const workspaces: Workspace[] = [];

  const patterns = ["packages", "apps"];

  for (const pattern of patterns) {
    const dir = path.join(root, pattern);
    if (!existsSync(dir)) continue;

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pkgJsonPath = path.join(dir, entry.name, "package.json");
        if (existsSync(pkgJsonPath)) {
          try {
            const content = await readFile(pkgJsonPath, "utf8");
            const json = JSON.parse(content);
            workspaces.push({
              name: json.name,
              path: `${pattern}/${entry.name}`,
              absolutePath: path.join(dir, entry.name),
              packageJson: json,
            });
          } catch {
            // ignore invalid json
          }
        }
      }
    }
  }

  return workspaces;
};

export const detectAffectedWorkspaces = async (changedFiles: string[]): Promise<Workspace[]> => {
  const workspaces = await getWorkspaces();
  const affected = new Set<Workspace>();

  // Root files that trigger everything
  const rootTriggers = ["package.json", "bun.lockb", "tsconfig.json", "tsconfig.base.json"];

  for (const file of changedFiles) {
    if (rootTriggers.includes(file)) {
      return workspaces;
    }

    for (const ws of workspaces) {
      if (file.startsWith(ws.path + "/")) {
        affected.add(ws);
      }
    }
  }

  return Array.from(affected);
};
