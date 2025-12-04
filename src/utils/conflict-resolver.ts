/**
 * Interactive conflict resolver for git merge/rebase conflicts
 */
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { COLORS, runCommand } from "./common.ts";

export interface ConflictBlock {
  startLine: number;
  endLine: number;
  current: string; // HEAD/current changes
  incoming: string; // incoming changes
  ancestor?: string; // common ancestor (if diff3 style)
}

export interface FileConflicts {
  filePath: string;
  conflicts: ConflictBlock[];
  originalContent: string;
}

/**
 * Parse a file and extract all conflict blocks
 */
export const parseConflicts = (content: string): ConflictBlock[] => {
  const lines = content.split("\n");
  const conflicts: ConflictBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    // Look for conflict start marker
    if (lines[i].startsWith("<<<<<<<")) {
      const startLine = i;
      const currentLines: string[] = [];
      const incomingLines: string[] = [];
      let inCurrent = true;

      i++; // Skip the <<<<<<< line

      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        if (lines[i].startsWith("=======")) {
          inCurrent = false;
        } else if (inCurrent) {
          currentLines.push(lines[i]);
        } else {
          incomingLines.push(lines[i]);
        }
        i++;
      }

      const endLine = i;

      conflicts.push({
        startLine,
        endLine,
        current: currentLines.join("\n"),
        incoming: incomingLines.join("\n"),
      });
    }
    i++;
  }

  return conflicts;
};

/**
 * Get all conflicted files with their conflicts parsed
 */
export const getFileConflicts = async (): Promise<FileConflicts[]> => {
  // Get list of conflicted files
  const { stdout } = await runCommand(["git", "diff", "--name-only", "--diff-filter=U"], { silent: true });
  const files = stdout.split("\n").filter(Boolean);

  const results: FileConflicts[] = [];

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, "utf-8");
      const conflicts = parseConflicts(content);

      if (conflicts.length > 0) {
        results.push({
          filePath,
          conflicts,
          originalContent: content,
        });
      }
    } catch {
      // File might have been deleted
    }
  }

  return results;
};

/**
 * Apply resolution choice to a conflict
 */
const resolveConflictBlock = (
  content: string,
  conflict: ConflictBlock,
  choice: "current" | "incoming" | "both"
): string => {
  const lines = content.split("\n");
  let resolution: string;

  switch (choice) {
    case "current":
      resolution = conflict.current;
      break;
    case "incoming":
      resolution = conflict.incoming;
      break;
    case "both":
      resolution = conflict.current + "\n" + conflict.incoming;
      break;
  }

  // Replace the conflict block with the resolution
  const before = lines.slice(0, conflict.startLine);
  const after = lines.slice(conflict.endLine + 1);

  return [...before, resolution, ...after].join("\n");
};

/**
 * Display a conflict with side-by-side comparison
 */
const displayConflict = (conflict: ConflictBlock, index: number, total: number): void => {
  console.log("");
  console.log(`${COLORS.bold}${COLORS.cyan}═══ Conflict ${index + 1} of ${total} ═══${COLORS.reset}`);
  console.log("");

  // Current (HEAD) changes
  console.log(`${COLORS.green}┌─── CURRENT (your changes) ───${COLORS.reset}`);
  const currentLines = conflict.current.split("\n");
  for (const line of currentLines) {
    console.log(`${COLORS.green}│${COLORS.reset} ${line}`);
  }
  console.log(`${COLORS.green}└${"─".repeat(30)}${COLORS.reset}`);

  console.log("");

  // Incoming changes
  console.log(`${COLORS.yellow}┌─── INCOMING (their changes) ───${COLORS.reset}`);
  const incomingLines = conflict.incoming.split("\n");
  for (const line of incomingLines) {
    console.log(`${COLORS.yellow}│${COLORS.reset} ${line}`);
  }
  console.log(`${COLORS.yellow}└${"─".repeat(30)}${COLORS.reset}`);

  console.log("");
};

/**
 * Prompt user for conflict resolution choice
 */
const promptResolution = async (): Promise<"current" | "incoming" | "both" | "skip" | "abort"> => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`${COLORS.cyan}Choose resolution:${COLORS.reset}`);
  console.log(`  ${COLORS.green}[c]${COLORS.reset} Keep current (your changes)`);
  console.log(`  ${COLORS.yellow}[i]${COLORS.reset} Accept incoming (their changes)`);
  console.log(`  ${COLORS.blue}[b]${COLORS.reset} Keep both`);
  console.log(`  ${COLORS.dim}[s]${COLORS.reset} Skip this conflict (resolve manually later)`);
  console.log(`  ${COLORS.red}[a]${COLORS.reset} Abort resolution`);
  console.log("");

  return new Promise((resolve) => {
    rl.question(`${COLORS.cyan}Your choice: ${COLORS.reset}`, (answer) => {
      rl.close();
      const choice = answer.trim().toLowerCase();

      switch (choice) {
        case "c":
        case "current":
          resolve("current");
          break;
        case "i":
        case "incoming":
          resolve("incoming");
          break;
        case "b":
        case "both":
          resolve("both");
          break;
        case "s":
        case "skip":
          resolve("skip");
          break;
        case "a":
        case "abort":
          resolve("abort");
          break;
        default:
          console.log(`${COLORS.yellow}Invalid choice, please try again${COLORS.reset}`);
          resolve(promptResolution());
      }
    });
  });
};

/**
 * Resolve conflicts in a single file interactively
 */
const resolveFileConflicts = async (
  fileConflicts: FileConflicts
): Promise<{ resolved: boolean; skipped: number; aborted: boolean }> => {
  console.log("");
  console.log(
    `${COLORS.bold}${COLORS.magenta}━━━ File: ${fileConflicts.filePath} (${fileConflicts.conflicts.length} conflict${fileConflicts.conflicts.length > 1 ? "s" : ""}) ━━━${COLORS.reset}`
  );

  let content = fileConflicts.originalContent;
  let skipped = 0;
  let resolvedCount = 0;

  // Process conflicts from bottom to top to preserve line numbers
  const sortedConflicts = [...fileConflicts.conflicts].sort((a, b) => b.startLine - a.startLine);

  for (let i = sortedConflicts.length - 1; i >= 0; i--) {
    const conflict = sortedConflicts[i];
    const displayIndex = fileConflicts.conflicts.length - 1 - i;

    displayConflict(conflict, displayIndex, fileConflicts.conflicts.length);

    const choice = await promptResolution();

    if (choice === "abort") {
      return { resolved: false, skipped: 0, aborted: true };
    }

    if (choice === "skip") {
      skipped++;
      console.log(`${COLORS.dim}Skipped - will need manual resolution${COLORS.reset}`);
      continue;
    }

    // Apply the resolution
    content = resolveConflictBlock(content, conflict, choice);
    resolvedCount++;
    console.log(`${COLORS.green}✓ Resolved with ${choice}${COLORS.reset}`);
  }

  // Write the resolved content back to file
  if (resolvedCount > 0) {
    await writeFile(fileConflicts.filePath, content, "utf-8");

    // Check if all conflicts are resolved (no more conflict markers)
    const remainingConflicts = parseConflicts(content);
    if (remainingConflicts.length === 0) {
      // Stage the file
      await runCommand(["git", "add", fileConflicts.filePath], { silent: true });
      console.log(`${COLORS.green}✓ File staged: ${fileConflicts.filePath}${COLORS.reset}`);
    }
  }

  return { resolved: skipped === 0, skipped, aborted: false };
};

export interface ResolveResult {
  success: boolean;
  filesResolved: number;
  filesSkipped: number;
  aborted: boolean;
}

/**
 * Main interactive conflict resolution flow
 */
export const resolveConflictsInteractively = async (): Promise<ResolveResult> => {
  const fileConflicts = await getFileConflicts();

  if (fileConflicts.length === 0) {
    console.log(`${COLORS.green}✓ No conflicts to resolve${COLORS.reset}`);
    return { success: true, filesResolved: 0, filesSkipped: 0, aborted: false };
  }

  console.log("");
  console.log(`${COLORS.bold}${COLORS.cyan}╔═══════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}║     Interactive Conflict Resolution       ║${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}╚═══════════════════════════════════════════╝${COLORS.reset}`);
  console.log("");
  console.log(`${COLORS.yellow}Found ${fileConflicts.length} file(s) with conflicts${COLORS.reset}`);

  let filesResolved = 0;
  let filesSkipped = 0;

  for (const fc of fileConflicts) {
    const result = await resolveFileConflicts(fc);

    if (result.aborted) {
      console.log("");
      console.log(`${COLORS.yellow}Resolution aborted by user${COLORS.reset}`);
      return { success: false, filesResolved, filesSkipped, aborted: true };
    }

    if (result.resolved) {
      filesResolved++;
    } else {
      filesSkipped++;
    }
  }

  console.log("");
  console.log(`${COLORS.bold}${COLORS.cyan}═══ Resolution Summary ═══${COLORS.reset}`);
  console.log(`  ${COLORS.green}✓ Files resolved: ${filesResolved}${COLORS.reset}`);
  if (filesSkipped > 0) {
    console.log(`  ${COLORS.yellow}⚠ Files with skipped conflicts: ${filesSkipped}${COLORS.reset}`);
  }

  const allResolved = filesSkipped === 0;

  if (allResolved) {
    console.log("");
    console.log(`${COLORS.green}✓ All conflicts resolved!${COLORS.reset}`);
  } else {
    console.log("");
    console.log(`${COLORS.yellow}Some conflicts were skipped. Resolve them manually then run:${COLORS.reset}`);
    console.log(`  ${COLORS.cyan}git add <files>${COLORS.reset}`);
  }

  return { success: allResolved, filesResolved, filesSkipped, aborted: false };
};

/**
 * Check if there are any unresolved conflicts
 */
export const hasUnresolvedConflicts = async (): Promise<boolean> => {
  try {
    const { stdout } = await runCommand(["git", "diff", "--name-only", "--diff-filter=U"], { silent: true });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
};
