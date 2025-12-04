/** biome-ignore-all lint/suspicious/noConsole: to show feedback */

import { trackFromResponse } from "../smart-token-tracker/index.ts";
import { COLORS, git, logger } from "../utils/common.ts";
import { callOpenRouter, createMessage, extractContent } from "../utils/openrouter.ts";
import { SYSTEM_PROMPT } from "./config.ts";
import { wrapText } from "./utils.ts";

/**
 * Extract Jira ID from branch name
 * Supports patterns like: feature/QWICK-123-description, bugfix/MOB-456-fix-thing, QWICK-789
 */
const extractJiraId = (branchName: string): string | null => {
  // Match common Jira patterns: PROJECT-NUMBER (e.g., QWICK-123, MOB-456)
  const match = branchName.match(/([A-Z]{2,10}-\d+)/);
  return match ? match[1] : null;
};

export const generateSquashMessage = async (model: string, commitsText: string, diffText: string): Promise<string> => {
  // Get current branch and extract Jira ID
  const currentBranch = await git.getCurrentBranch();
  const jiraId = extractJiraId(currentBranch);

  if (!jiraId) {
    console.log(`\n${COLORS.yellow}⚠️  Warning: No Jira ID detected in branch name '${currentBranch}'${COLORS.reset}`);
    console.log(`${COLORS.dim}Expected format: feature/QWICK-123-description${COLORS.reset}`);
    console.log(`${COLORS.yellow}You will need to manually add [JIRA-ID] to the commit message.${COLORS.reset}\n`);
  } else {
    console.log(`${COLORS.green}✓ Detected Jira ID: ${jiraId}${COLORS.reset}\n`);
  }

  const jiraContext = jiraId
    ? `\nJira ID for this commit: ${jiraId}\nYou MUST include [${jiraId}] in the subject line after the scope.`
    : `\nNo Jira ID detected. Include [JIRA-ID] placeholder in the subject line.`;

  const prompt = SYSTEM_PROMPT.replace("[COMMITS]", commitsText).replace("[DIFF]", diffText + jiraContext);

  logger.info(`📝 Generating commit message with OpenRouter (Model: ${model})...`);

  try {
    const response = await callOpenRouter([createMessage(prompt)], {
      model,
      temperature: 0.3,
      max_tokens: 500,
      scriptName: "Qwick Squash Message Generator",
    });

    let message = extractContent(response);

    // Post-process: Wrap body lines at 100 chars
    const lines = message.split("\n");
    let subject = lines[0];
    const body = lines.slice(1).join("\n");
    const wrappedBody = wrapText(body, 100);

    // Validate Jira ID is present
    if (!subject.match(/\[[A-Z]{2,10}-\d+\]/)) {
      if (jiraId) {
        // Try to inject Jira ID if AI didn't include it
        const typeScope = subject.match(/^([a-z]+\([a-z-]+\):)(.*)$/i);
        if (typeScope) {
          subject = `${typeScope[1]} [${jiraId}]${typeScope[2]}`;
          console.log(`${COLORS.yellow}⚠️  Jira ID was missing, automatically added [${jiraId}]${COLORS.reset}`);
        }
      } else {
        console.log(`${COLORS.yellow}⚠️  No Jira ID in commit message. Please add manually.${COLORS.reset}`);
      }
    }

    message = `${subject}\n${wrappedBody}`.trim();

    await trackFromResponse("smart-git-squash", response, model);

    return message;
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Failed to generate commit message: ${e.message}`);
    }
    process.exit(1);
  }
};
