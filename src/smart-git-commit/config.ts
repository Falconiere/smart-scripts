import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectRoot } from "@/utils/common.ts";
import { getConfig } from "@/utils/config.ts";
import { DEFAULT_COMMIT_CONFIG, DEFAULT_COMMIT_TYPES, type CommitConfig } from "@/schemas/config.ts";

interface SemanticYaml {
  types?: string[];
  scopes?: string[];
  titleOnly?: boolean;
}

/**
 * Parse semantic.yml file to extract types and scopes
 */
const parseSemanticYaml = (content: string): SemanticYaml | null => {
  try {
    // Use Bun's built-in YAML parser
    const parsed = Bun.YAML.parse(content) as SemanticYaml;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Load semantic.yml from common locations
 */
const loadSemanticConfig = (): SemanticYaml | null => {
  const root = getProjectRoot();
  const paths = [
    ".github/semantic.yml",
    ".github/semantic.yaml",
    "semantic.yml",
    "semantic.yaml",
  ];

  for (const path of paths) {
    const fullPath = join(root, path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf-8");
      return parseSemanticYaml(content);
    }
  }

  return null;
};

/**
 * Convert semantic.yml types to CommitConfig types format
 */
const convertSemanticTypes = (types: string[]): { type: string; description: string }[] => {
  // Map of type descriptions
  const descriptions: Record<string, string> = {
    feat: "A new feature",
    fix: "A bug fix",
    hotfix: "Critical bug fix requiring immediate deployment",
    docs: "Documentation only changes",
    style: "Changes that do not affect the meaning of the code",
    refactor: "A code change that neither fixes a bug nor adds a feature",
    perf: "A code change that improves performance",
    test: "Adding missing tests or correcting existing tests",
    build: "Changes that affect the build system or external dependencies",
    ci: "Changes to CI configuration files and scripts",
    chore: "Other changes that don't modify src or test files",
    release: "Version release",
    revert: "Reverts a previous commit",
  };

  return types.map((type) => ({
    type,
    description: descriptions[type] ?? `${type} changes`,
  }));
};

/**
 * Get the commit configuration with defaults
 * Automatically loads semantic.yml if present
 */
export const getCommitConfig = (): CommitConfig => {
  const config = getConfig();
  const commitConfig = config.commit;
  const semanticConfig = loadSemanticConfig();

  // Start with defaults
  let result: CommitConfig = { ...DEFAULT_COMMIT_CONFIG };

  // Merge semantic.yml if found
  if (semanticConfig) {
    if (semanticConfig.types?.length) {
      result.types = convertSemanticTypes(semanticConfig.types);
    }
    if (semanticConfig.scopes?.length) {
      // Filter out comment lines (strings that are just comments)
      result.scopes = semanticConfig.scopes.filter(
        (s) => typeof s === "string" && !s.trim().startsWith("#")
      );
      result.requireScope = true; // If scopes are defined, require them
    }
  }

  // Merge user config (takes priority)
  if (commitConfig) {
    result = {
      ...result,
      ...commitConfig,
      types: commitConfig.types ?? result.types,
      scopes: commitConfig.scopes ?? result.scopes,
      ticketId: commitConfig.ticketId ?? undefined,
    };
  }

  return result;
};

/**
 * Try to load a custom template file
 * Supports commit templates and can optionally use PR template for context
 */
export const loadCustomTemplate = (): string | null => {
  const config = getCommitConfig();
  const root = getProjectRoot();

  // Check for explicit template path in config
  if (config.template) {
    const templatePath = join(root, config.template);
    if (existsSync(templatePath)) {
      return readFileSync(templatePath, "utf-8");
    }
  }

  // Check common template locations (commit-specific first)
  const commonPaths = [
    ".github/commit_template.md",
    ".github/COMMIT_TEMPLATE.md",
    "commit_template.md",
    ".commit_template.md",
  ];

  for (const path of commonPaths) {
    const fullPath = join(root, path);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8");
    }
  }

  return null;
};

/**
 * Load PR template for additional context (optional)
 * This provides context about the project's PR conventions
 */
export const loadPrTemplate = (): string | null => {
  const root = getProjectRoot();
  const paths = [
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "pull_request_template.md",
  ];

  for (const path of paths) {
    const fullPath = join(root, path);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8");
    }
  }

  return null;
};

/**
 * Build the commit types section for the prompt
 */
const buildTypesSection = (config: CommitConfig): string => {
  const types = config.types ?? DEFAULT_COMMIT_TYPES;
  return types.map((t) => `- ${t.type}: ${t.description}`).join("\n");
};

/**
 * Build the scopes section for the prompt
 */
const buildScopesSection = (config: CommitConfig): string => {
  if (!config.scopes?.length) {
    return config.requireScope
      ? "Scope is REQUIRED but no predefined scopes are set. Use a descriptive scope for the change."
      : "Scope is optional. If used, make it descriptive of the area changed.";
  }

  const scopeList = config.scopes.join(", ");
  return config.requireScope
    ? `Scope is REQUIRED. Valid scopes: ${scopeList}`
    : `Valid scopes (optional): ${scopeList}`;
};

/**
 * Build ticket ID section for the prompt
 */
const buildTicketIdSection = (config: CommitConfig, ticketId?: string): string => {
  const ticketConfig = config.ticketId;

  if (!ticketConfig?.enabled) {
    return "";
  }

  if (ticketId) {
    return ticketConfig.required
      ? `\nTicket ID: ${ticketId} - MUST be included in the subject line as [${ticketId}]`
      : `\nTicket ID: ${ticketId} - Include as [${ticketId}] in the subject line if relevant`;
  }

  return ticketConfig.required
    ? "\nNo ticket ID detected from branch. Include [TICKET-ID] placeholder in subject line."
    : "";
};

/**
 * Generate the system prompt based on configuration
 */
export const generateSystemPrompt = (ticketId?: string): string => {
  const config = getCommitConfig();

  // Check for custom template first
  const customTemplate = loadCustomTemplate();
  if (customTemplate) {
    // If custom template exists, use it with minimal wrapper
    return `You are an expert at writing clear, concise git commit messages.

Use the following template/guidelines provided by the project:

${customTemplate}

${buildTicketIdSection(config, ticketId)}

Analyze the staged changes and generate a commit message following the template above.
Output ONLY the commit message, no explanations or markdown code blocks.`;
  }

  // Build dynamic prompt based on config
  const scopeFormat = config.requireScope ? "(<scope>)" : "[(<scope>)]";
  const ticketFormat = config.ticketId?.enabled
    ? config.ticketId.required
      ? " [TICKET-ID]"
      : " [TICKET-ID]?"
    : "";

  const bodyRule = config.requireBody
    ? "Body: REQUIRED - explain WHAT changed and WHY (1-3 sentences minimum)"
    : "Body: optional for simple changes, explain WHAT and WHY";

  return `You are an expert at writing clear, concise git commit messages following the Conventional Commits specification.

Analyze the staged changes and generate a commit message following these rules:

FORMAT:
<type>${scopeFormat}:${ticketFormat} <subject>

<body>

COMMIT TYPES:
${buildTypesSection(config)}

SCOPES:
${buildScopesSection(config)}
${buildTicketIdSection(config, ticketId)}

RULES:
1. Subject line: max ${config.maxSubjectLength} characters, imperative mood ("add" not "added")
2. First letter of subject should be lowercase
3. No period at the end of the subject line
4. ${bodyRule}
5. Body lines: wrap at ${config.maxBodyLength} characters max
6. Be specific and meaningful
7. Reference issue/PR numbers if relevant

EXAMPLES:
feat(auth): add OAuth2 login support

Implement OAuth2 authentication flow with support for Google and GitHub providers.
Users can now link their existing accounts with social logins.

---

fix(api): resolve race condition in request handler

The request handler was not properly awaiting async operations, causing
intermittent failures under high load.

---

chore(deps): upgrade typescript to v5.3

Update TypeScript and related type definitions to latest stable version for
improved type checking and new language features.

---

Recent commit style reference (for consistency):`;
};

// Legacy export for backward compatibility
export const SYSTEM_PROMPT = generateSystemPrompt();
