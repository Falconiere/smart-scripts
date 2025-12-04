import { getCommitConfig } from "@/smart-git-commit/config.ts";
import { DEFAULT_COMMIT_TYPES } from "@/schemas/config.ts";

/**
 * Generate a dynamic system prompt for squash commits based on config
 */
export const generateSquashPrompt = (ticketId?: string): string => {
  const config = getCommitConfig();
  const types = config.types ?? DEFAULT_COMMIT_TYPES;

  // Build types section
  const typesSection = types.map((t) => `- ${t.type}: ${t.description}`).join("\n");

  // Build scopes section
  let scopesSection = "";
  if (config.scopes?.length) {
    scopesSection = `\nVALID SCOPES:\n${config.scopes.join(", ")}\n`;
  }

  // Build ticket ID context
  let ticketContext = "";
  if (ticketId) {
    ticketContext = `\nTicket ID for this commit: ${ticketId}\nInclude [${ticketId}] in the subject line if relevant.`;
  }

  return `You are an expert at writing clear, concise git commit messages following conventional commit format.

Analyze the following commits that are being squashed and generate ONE comprehensive commit message.

Commits being squashed:
[COMMITS]

Summary of changes:
[DIFF]${ticketContext}

FORMAT:
<type>(<scope>): <subject>

<body>

VALID TYPES:
${typesSection}
${scopesSection}
RULES:
1. Subject line: max ${config.maxSubjectLength} chars, imperative mood ("add" not "added")
2. First letter of subject should be lowercase
3. No period at the end of the subject line
4. Body: explain WHAT and WHY, not HOW
5. Body lines: wrap at ${config.maxBodyLength} chars max
6. If multiple scopes/types are involved, choose the most significant one
7. Focus on the overall purpose, not individual commits
8. Be specific and meaningful

EXAMPLES:
feat(auth): add OAuth2 login support

Implement OAuth2 authentication flow with support for Google and GitHub providers.
Users can now link their existing accounts with social logins.

---

refactor(deps): upgrade dependencies and consolidate automation

Migrate bash scripts to TypeScript for better maintainability. Update all
dependencies and consolidate automation into unified command.

Return ONLY the commit message, no explanations or markdown code blocks.`;
};

// Legacy export for backward compatibility (without ticket ID)
export const SYSTEM_PROMPT = generateSquashPrompt();
