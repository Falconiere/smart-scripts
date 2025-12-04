/** biome-ignore-all lint/suspicious/noConsole: to show feedback */

import { trackFromResponse } from "../smart-token-tracker/index.ts";
import { COLORS, git, logger } from "../utils/common.ts";
import { callOpenRouter, createMessage, extractContent } from "../utils/openrouter.ts";
import { getCommitConfig } from "@/smart-git-commit/config.ts";
import { generateSquashPrompt } from "./config.ts";
import { wrapText } from "./utils.ts";

/**
 * Extract ticket ID from branch name (supports common formats like PROJ-123, ABC-456)
 */
const extractTicketId = (branchName: string): string | null => {
  const match = branchName.match(/([A-Z]{2,10}-\d+)/);
  return match ? match[1] : null;
};

export const generateSquashMessage = async (model: string, commitsText: string, diffText: string): Promise<string> => {
  const config = getCommitConfig();
  const ticketConfig = config.ticketId;

  // Get current branch and extract ticket ID if configured
  const currentBranch = await git.getCurrentBranch();
  let ticketId: string | undefined;

  if (ticketConfig?.enabled) {
    ticketId = extractTicketId(currentBranch) ?? undefined;

    if (ticketId) {
      console.log(`${COLORS.green}✓ Detected ticket ID: ${ticketId}${COLORS.reset}\n`);
    } else if (ticketConfig.required) {
      console.log(`\n${COLORS.yellow}⚠️  Warning: No ticket ID detected in branch name '${currentBranch}'${COLORS.reset}`);
      console.log(`${COLORS.dim}Expected format: feature/PROJ-123-description${COLORS.reset}\n`);
    }
  }

  // Generate dynamic prompt with ticket context
  const systemPrompt = generateSquashPrompt(ticketId);
  const prompt = systemPrompt.replace("[COMMITS]", commitsText).replace("[DIFF]", diffText);

  logger.info(`📝 Generating commit message with OpenRouter (Model: ${model})...`);

  try {
    const response = await callOpenRouter([createMessage(prompt)], {
      model,
      temperature: 0.3,
      max_tokens: 500,
      scriptName: "sg squash",
    });

    let message = extractContent(response);

    // Post-process: Wrap body lines
    const lines = message.split("\n");
    let subject = lines[0];
    const body = lines.slice(1).join("\n");
    const wrappedBody = wrapText(body, config.maxBodyLength);

    // Validate ticket ID is present if required
    if (ticketConfig?.enabled && ticketConfig.required && ticketId) {
      const ticketPattern = new RegExp(`\\[${ticketId}\\]`);
      if (!subject.match(ticketPattern)) {
        // Try to inject ticket ID if AI didn't include it
        const typeScope = subject.match(/^([a-z]+(?:\([a-z-]+\))?:)(.*)$/i);
        if (typeScope) {
          subject = `${typeScope[1]} [${ticketId}]${typeScope[2]}`;
          console.log(`${COLORS.yellow}⚠️  Ticket ID was missing, automatically added [${ticketId}]${COLORS.reset}`);
        }
      }
    }

    message = `${subject}\n${wrappedBody}`.trim();

    await trackFromResponse("sg squash", response, model);

    return message;
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Failed to generate commit message: ${e.message}`);
    }
    process.exit(1);
  }
};
