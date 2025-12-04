/** biome-ignore-all lint/suspicious/noConsole: to show feedback */

import { trackFromResponse } from "../smart-token-tracker/index.ts";
import { COLORS, git, logger, runCommand } from "../utils/common.ts";
import { callOpenRouter, createMultiPartMessage, extractContent, printUsageStats } from "../utils/openrouter.ts";
import { generateSystemPrompt, getCommitConfig } from "./config.ts";
import { wrapText } from "./utils.ts";

/**
 * Extract ticket ID from branch name based on configured pattern
 */
const extractTicketId = (branchName: string, pattern: string): string | null => {
  try {
    const regex = new RegExp(`(${pattern})`);
    const match = branchName.match(regex);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

export const generateCommitMessage = async (model: string) => {
  const config = getCommitConfig();
  const ticketConfig = config.ticketId;

  // Get current branch and extract ticket ID if configured
  const currentBranch = await git.getCurrentBranch();
  let ticketId: string | undefined;

  if (ticketConfig?.enabled) {
    const pattern = ticketConfig.pattern ?? "[A-Z]{2,10}-\\d+";
    ticketId = extractTicketId(currentBranch, pattern) ?? undefined;

    if (!ticketId && ticketConfig.required) {
      console.log(`\n${COLORS.yellow}⚠️  Warning: No ticket ID detected in branch name '${currentBranch}'${COLORS.reset}`);
      console.log(`${COLORS.dim}Expected pattern: ${pattern}${COLORS.reset}`);
      console.log(`${COLORS.yellow}You may need to manually add the ticket ID to the commit message.${COLORS.reset}\n`);
    } else if (ticketId) {
      console.log(`${COLORS.green}✓ Detected ticket ID: ${ticketId}${COLORS.reset}\n`);
    }
  }

  // Get staged diff
  let diff = await git.getStagedDiff();
  const diffStat = await git.getStagedDiffStat();
  const gitStatus = (await runCommand(["git", "status", "--short"], { silent: true })).stdout;

  // Get list of changed files
  const files = (await runCommand(["git", "diff", "--cached", "--name-only"], { silent: true })).stdout
    .split("\n")
    .filter(Boolean);

  // Check if diff is too large (approx token count) - use conservative limit
  const estimatedTokens = diff.length / 4;
  const MAX_TOKENS = 30000; // Conservative limit to leave room for system prompt and response

  if (estimatedTokens > MAX_TOKENS) {
    const fileCount = files.length;
    logger.warn(`Large changeset detected (${fileCount} files, ~${Math.round(estimatedTokens).toLocaleString()} tokens)`);
    logger.info("Using smart diff summarization...");

    // Construct smart compact diff
    let compactDiff = `=== CHANGESET SUMMARY (${fileCount} files) ===\n${diffStat}\n\n`;

    // Categorize files by type for better context
    const categories: Record<string, string[]> = {};
    for (const file of files) {
      const ext = file.split(".").pop() || "other";
      if (!categories[ext]) categories[ext] = [];
      categories[ext].push(file);
    }

    compactDiff += "=== FILES BY TYPE ===\n";
    for (const [ext, fileList] of Object.entries(categories)) {
      compactDiff += `${ext}: ${fileList.length} files\n`;
    }
    compactDiff += "\n";

    // Calculate token budget per file
    const tokenBudgetPerFile = Math.floor((MAX_TOKENS * 4) / Math.max(fileCount, 1));
    const linesPerFile = Math.max(10, Math.min(50, Math.floor(tokenBudgetPerFile / 100)));

    compactDiff += `=== KEY CHANGES (${linesPerFile} lines per file) ===\n`;

    for (const file of files) {
      try {
        const fileDiff = (await runCommand(["git", "diff", "--cached", "--unified=2", "--", file], { silent: true }))
          .stdout;

        // Get the most important lines: header + first N lines of actual changes
        const lines = fileDiff.split("\n");
        const headerLines = lines.filter(l => l.startsWith("@@") || l.startsWith("---") || l.startsWith("+++")).slice(0, 3);
        const changeLines = lines.filter(l => l.startsWith("+") || l.startsWith("-")).slice(0, linesPerFile);

        if (changeLines.length > 0) {
          compactDiff += `\n--- ${file} ---\n`;
          compactDiff += headerLines.join("\n") + "\n";
          compactDiff += changeLines.join("\n");
          if (lines.length > headerLines.length + changeLines.length) {
            compactDiff += `\n... (${lines.length - headerLines.length - changeLines.length} more lines)\n`;
          }
        }
      } catch {
        compactDiff += `\n--- ${file} --- (could not read diff)\n`;
      }
    }

    diff = compactDiff;
    console.log(`${COLORS.green}✓${COLORS.reset} Diff compressed to ~${Math.round(diff.length / 4).toLocaleString()} tokens`);
  }

  const recentCommits = await git.getRecentCommits();

  const analysisPrompt = `
Staged changes summary:
${gitStatus}

Detailed diff:
${diff}

Generate a commit message following the format above. Output ONLY the commit message, no explanations or markdown code blocks.`;

  logger.info(`📝 Generating commit message with OpenRouter (Model: ${model})...`);

  try {
    // Generate prompt with ticket ID context
    const systemPrompt = generateSystemPrompt(ticketId);

    // Build message parts, excluding empty ones
    const parts: { text: string; cached: boolean }[] = [
      { text: systemPrompt, cached: true },
    ];

    // Only include recent commits if there are any
    if (recentCommits.trim()) {
      parts.push({ text: recentCommits, cached: true });
    }

    parts.push({ text: analysisPrompt, cached: false });

    const messages = [createMultiPartMessage(parts)];

    const response = await callOpenRouter(messages, {
      model,
      temperature: 0.3,
      max_tokens: 500,
      scriptName: "sg commit",
    });

    let message = extractContent(response);

    // Post-process: Wrap body lines
    const lines = message.split("\n");
    const subject = lines[0];
    const body = lines.slice(1).join("\n");
    const wrappedBody = wrapText(body, config.maxBodyLength);

    // Validate ticket ID if required
    if (ticketConfig?.enabled && ticketConfig.required && ticketId) {
      const ticketPattern = new RegExp(`\\[${ticketId}\\]`);
      if (!subject.match(ticketPattern)) {
        // Try to inject ticket ID if AI didn't include it
        const typeScope = subject.match(/^([a-z]+(?:\([a-z-]+\))?:)(.*)$/i);
        if (typeScope) {
          const newSubject = `${typeScope[1]} [${ticketId}]${typeScope[2]}`;
          message = `${newSubject}\n${wrappedBody}`.trim();
          console.log(`${COLORS.yellow}⚠️  Ticket ID was missing, automatically added [${ticketId}]${COLORS.reset}`);
        } else {
          console.log(`${COLORS.yellow}⚠️  Could not inject ticket ID. Please add [${ticketId}] manually.${COLORS.reset}`);
          message = `${subject}\n${wrappedBody}`.trim();
        }
      } else {
        message = `${subject}\n${wrappedBody}`.trim();
      }
    } else {
      message = `${subject}\n${wrappedBody}`.trim();
    }

    await trackFromResponse("smart-git-commit", response, model);

    // Print stats
    logger.success("Commit message generated!");
    printUsageStats(response);

    return message;
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Failed to generate commit message: ${e.message}`);
    }
    process.exit(1);
  }
};
