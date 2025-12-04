/** biome-ignore-all lint/suspicious/noConsole: to show feedback */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { trackFromResponse } from "../smart-token-tracker/index.ts";
import { COLORS, getProjectRoot, logger, runCommand } from "../utils/common.ts";
import { callOpenRouter, createMultiPartMessage, extractContent, printUsageStats } from "../utils/openrouter.ts";

/**
 * Load PR template from .github/pull_request_template.md
 */
const loadPRTemplate = async (): Promise<string> => {
  const templatePath = path.join(getProjectRoot(), ".github", "pull_request_template.md");
  if (existsSync(templatePath)) {
    return await readFile(templatePath, "utf-8");
  }
  return "";
};

/**
 * Load semantic config for valid types and scopes
 */
const loadSemanticConfig = async (): Promise<{ types: string[]; scopes: string[] }> => {
  const configPath = path.join(getProjectRoot(), ".github", "semantic.yml");
  if (!existsSync(configPath)) {
    return { types: [], scopes: [] };
  }

  const content = await readFile(configPath, "utf-8");
  const types: string[] = [];
  const scopes: string[] = [];

  let inTypes = false;
  let inScopes = false;

  for (const line of content.split("\n")) {
    if (line.startsWith("types:")) {
      inTypes = true;
      inScopes = false;
      continue;
    }
    if (line.startsWith("scopes:")) {
      inScopes = true;
      inTypes = false;
      continue;
    }
    if (line.match(/^\w+:/)) {
      inTypes = false;
      inScopes = false;
      continue;
    }

    const match = line.match(/^\s+-\s+(\S+)/);
    if (match) {
      if (inTypes) types.push(match[1]);
      if (inScopes) scopes.push(match[1]);
    }
  }

  return { types, scopes };
};

const createPRSystemPrompt = (template: string, semanticConfig: { types: string[]; scopes: string[] }): string => {
  return `You are a PR description generator for the Qwick mobile app (React Native).

The project uses this PR template:
---
${template}
---

VALID TYPES: ${semanticConfig.types.join(", ")}
VALID SCOPES: ${semanticConfig.scopes.join(", ")}

Generate a PR description following the template structure. Fill in:
1. "What is the goal of this PR?" - Brief description of the changes
2. "How am I solving the problem?" - Technical approach summary
3. Check relevant items in "Things to consider"
4. Add "Notes for code-reviewer" if there are important implementation details
5. Add "Notes for QA" with testing instructions

For the PR TITLE, use format: type(scope): [JIRA-ID] description
- Type must be one of the valid types
- Scope must be one of the valid scopes
- Include the Jira ID from the branch name

Output ONLY the filled template content, no code blocks or extra formatting.`;
};

/**
 * Extract Jira ID from branch name
 */
const extractJiraId = (branchName: string): string | null => {
  const match = branchName.match(/([A-Z]{2,10}-\d+)/);
  return match ? match[1] : null;
};

/**
 * Check if a PR already exists for the current branch
 */
export const checkExistingPR = async (branch: string): Promise<{ exists: boolean; url?: string; number?: number }> => {
  try {
    const { stdout, exitCode } = await runCommand(
      ["gh", "pr", "view", branch, "--json", "url,number,state"],
      { silent: true, ignoreExitCode: true }
    );

    if (exitCode !== 0 || !stdout.trim()) {
      return { exists: false };
    }

    const data = JSON.parse(stdout);
    if (data.state === "OPEN") {
      return { exists: true, url: data.url, number: data.number };
    }
    return { exists: false };
  } catch {
    return { exists: false };
  }
};

/**
 * Get commits that will be included in the PR
 */
const getPRCommits = async (baseBranch: string): Promise<string> => {
  try {
    const { stdout } = await runCommand(
      ["git", "log", `${baseBranch}..HEAD`, "--pretty=format:%s", "--reverse"],
      { silent: true }
    );
    return stdout;
  } catch {
    return "";
  }
};

/**
 * Get the diff summary for PR description generation
 */
const getPRDiffSummary = async (baseBranch: string): Promise<string> => {
  try {
    const { stdout } = await runCommand(
      ["git", "diff", `${baseBranch}...HEAD`, "--stat"],
      { silent: true }
    );
    return stdout;
  } catch {
    return "";
  }
};

/**
 * Generate a PR title from commits
 */
const generatePRTitle = async (branch: string, commits: string): Promise<string> => {
  const jiraId = extractJiraId(branch);
  const commitLines = commits.split("\n").filter(Boolean);

  // If single commit, use it as title
  if (commitLines.length === 1) {
    return commitLines[0];
  }

  // Otherwise, try to summarize
  // Find the most descriptive commit (usually the first feature commit)
  const featureCommit = commitLines.find((c) =>
    c.match(/^(feat|feature|add|implement)/i)
  );

  if (featureCommit) {
    return featureCommit;
  }

  // Fallback: use branch name with Jira ID
  const branchDescription = branch
    .replace(/^[^/]+\//, "") // Remove prefix like falco/
    .replace(/[A-Z]{2,10}-\d+-?/g, "") // Remove Jira ID
    .replace(/-/g, " ")
    .trim();

  if (jiraId && branchDescription) {
    return `feat: [${jiraId}] ${branchDescription}`;
  }

  return commitLines[0] || `Changes from ${branch}`;
};

/**
 * Generate PR description using AI with project template
 */
export const generatePRDescription = async (
  branch: string,
  baseBranch: string,
  model: string
): Promise<{ title: string; body: string }> => {
  const commits = await getPRCommits(baseBranch);
  const diffSummary = await getPRDiffSummary(baseBranch);
  const jiraId = extractJiraId(branch);

  // Load project-specific PR template and semantic config
  const [prTemplate, semanticConfig] = await Promise.all([
    loadPRTemplate(),
    loadSemanticConfig(),
  ]);

  const systemPrompt = createPRSystemPrompt(prTemplate, semanticConfig);

  const prompt = `Generate a PR description for the following changes:

Branch: ${branch}
Base branch: ${baseBranch}
${jiraId ? `Jira ID: ${jiraId}` : "No Jira ID detected - use [JIRA-ID] placeholder"}

Commits included in this PR:
${commits}

Files changed summary:
${diffSummary}

Generate the PR title and description following the template format. The title should follow: type(scope): [${jiraId || "JIRA-ID"}] description`;

  logger.info(`📝 Generating PR description with AI (Model: ${model})...`);

  try {
    const messages = [
      createMultiPartMessage([
        { text: systemPrompt, cached: true },
        { text: prompt, cached: false },
      ]),
    ];

    const response = await callOpenRouter(messages, {
      model,
      temperature: 0.3,
      max_tokens: 1000,
      scriptName: "Qwick PR Description Generator",
    });

    const body = extractContent(response);

    await trackFromResponse("smart-git-push", response, model);
    printUsageStats(response);

    const title = await generatePRTitle(branch, commits);

    return { title, body };
  } catch (e) {
    logger.warn("Failed to generate AI description, using default template");

    const title = await generatePRTitle(branch, commits);
    const commitList = commits
      .split("\n")
      .filter(Boolean)
      .map((c) => `- ${c}`)
      .join("\n");

    // Use project template as fallback structure
    const body = `## What is the goal of this PR?
> Jira Link: ${jiraId || "GOLD-"}

${commitList || "Changes from this branch"}

## How am I solving the problem?
> See commits above for detailed changes.

## Things to consider

**General:**
- [ ] Branch contains work type/Jira tag
- [ ] PR title matches \`type(scope): [JIRA-ticket] description\` format
- [ ] Got tests?

## Notes for code-reviewer
> Review the commits for implementation details.

## Notes for QA
> Test the affected areas of the application.`;

    return { title, body };
  }
};

/**
 * Create a PR using GitHub CLI
 */
export const createPR = async (
  title: string,
  body: string,
  baseBranch: string,
  isDraft: boolean
): Promise<string> => {
  const args = [
    "gh", "pr", "create",
    "--title", title,
    "--body", body,
    "--base", baseBranch,
  ];

  if (isDraft) {
    args.push("--draft");
  }

  const { stdout } = await runCommand(args, { silent: true });
  return stdout.trim();
};

/**
 * Main PR workflow - checks for existing PR or creates new one
 */
export const ensurePR = async (
  currentBranch: string,
  baseBranch: string,
  model: string,
  isDraft: boolean,
  autoYes: boolean
): Promise<void> => {
  // Don't create PR for main branch
  if (currentBranch === baseBranch || currentBranch === "main" || currentBranch === "master") {
    console.log(`${COLORS.dim}Skipping PR creation for ${currentBranch} branch${COLORS.reset}`);
    return;
  }

  console.log(`\n${COLORS.yellow}🔍 Checking for existing PR...${COLORS.reset}`);

  const existing = await checkExistingPR(currentBranch);

  if (existing.exists) {
    console.log(`${COLORS.green}✓${COLORS.reset} PR already exists: ${COLORS.cyan}${existing.url}${COLORS.reset}`);
    return;
  }

  console.log(`${COLORS.cyan}No existing PR found. Creating one...${COLORS.reset}`);

  try {
    const { title, body } = await generatePRDescription(currentBranch, baseBranch, model);

    console.log(`\n${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.yellow}PR Title:${COLORS.reset} ${title}`);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(body);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);

    if (isDraft) {
      console.log(`${COLORS.dim}(Creating as draft PR)${COLORS.reset}`);
    }

    const prUrl = await createPR(title, body, baseBranch, isDraft);

    logger.success(`PR created successfully!`);
    console.log(`${COLORS.green}🔗 ${prUrl}${COLORS.reset}`);
  } catch (e) {
    if (e instanceof Error) {
      // Check if gh CLI is not installed or not authenticated
      if (e.message.includes("gh: command not found") || e.message.includes("not found")) {
        logger.warn("GitHub CLI (gh) not installed. Skipping PR creation.");
        console.log(`${COLORS.dim}Install with: brew install gh${COLORS.reset}`);
      } else if (e.message.includes("authentication") || e.message.includes("not logged")) {
        logger.warn("GitHub CLI not authenticated. Skipping PR creation.");
        console.log(`${COLORS.dim}Authenticate with: gh auth login${COLORS.reset}`);
      } else {
        logger.error(`Failed to create PR: ${e.message}`);
      }
    }
  }
};
