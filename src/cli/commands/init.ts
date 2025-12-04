/**
 * sg init - Interactive setup wizard for sg configuration
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import * as p from "@clack/prompts";
import color from "picocolors";

import { getProjectRoot, runCommand } from "@/utils/common.ts";
import { getConfigPaths, VERSION } from "@/utils/config.ts";
import { InitArgsSchema } from "@/schemas/cli.ts";
import { DEFAULT_MODEL_TIERS } from "@/schemas/config.ts";

interface DetectedTemplates {
  semanticYaml: { path: string; types: string[]; scopes: string[] } | null;
  commitTemplate: string | null;
  prTemplate: string | null;
}

/**
 * Detect existing templates in the project
 */
const detectTemplates = (): DetectedTemplates => {
  const root = getProjectRoot();
  const result: DetectedTemplates = {
    semanticYaml: null,
    commitTemplate: null,
    prTemplate: null,
  };

  // Check for semantic.yml
  const semanticPaths = [".github/semantic.yml", ".github/semantic.yaml", "semantic.yml"];
  for (const path of semanticPaths) {
    const fullPath = join(root, path);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const parsed = Bun.YAML.parse(content) as { types?: string[]; scopes?: string[] };
        result.semanticYaml = {
          path,
          types: parsed.types ?? [],
          scopes: (parsed.scopes ?? []).filter((s: string) => typeof s === "string"),
        };
      } catch {
        // Ignore parse errors
      }
      break;
    }
  }

  // Check for commit template
  const commitPaths = [".github/commit_template.md", ".github/COMMIT_TEMPLATE.md", "commit_template.md"];
  for (const path of commitPaths) {
    const fullPath = join(root, path);
    if (existsSync(fullPath)) {
      result.commitTemplate = path;
      break;
    }
  }

  // Check for PR template
  const prPaths = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md"];
  for (const path of prPaths) {
    const fullPath = join(root, path);
    if (existsSync(fullPath)) {
      result.prTemplate = path;
      break;
    }
  }

  return result;
};

/**
 * Try to detect ticket ID pattern from PR template content
 */
const detectTicketPattern = (prTemplatePath: string): string | null => {
  const root = getProjectRoot();
  try {
    const content = readFileSync(join(root, prTemplatePath), "utf-8");
    // Look for common patterns like JIRA-123, GOLD-123, etc.
    const patterns = [
      { regex: /\b([A-Z]{2,10})-\d+/, name: "JIRA-style" },
      { regex: /\[([A-Z]{2,10})-\d+\]/, name: "JIRA in brackets" },
      { regex: /#(\d+)/, name: "GitHub issue" },
    ];

    for (const { regex } of patterns) {
      const match = content.match(regex);
      if (match) {
        // Extract the prefix pattern
        const prefixMatch = content.match(/([A-Z]{2,10})-/);
        if (prefixMatch) {
          return `${prefixMatch[1]}-\\\\d+`;
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
};

interface InitCommandArgs {
  global?: boolean;
  force?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  dryRun?: boolean;
  noColor?: boolean;
}

interface ConfigOptions {
  baseBranch: string;
  model: string;
  forceWithLease: boolean;
  colors: boolean;
  cacheEnabled: boolean;
  // Commit options
  useSemanticYaml?: boolean;
  useCommitTemplate?: string;
  ticketId?: {
    enabled: boolean;
    pattern: string;
    required: boolean;
  };
}

const generateConfigContent = (options: ConfigOptions): string => {
  let commitSection = "";

  // Build commit configuration if any options are set
  const hasCommitConfig = options.ticketId?.enabled || options.useCommitTemplate;

  if (hasCommitConfig) {
    const parts: string[] = [];

    if (options.useCommitTemplate) {
      parts.push(`    template: "${options.useCommitTemplate}",`);
    }

    if (options.ticketId?.enabled) {
      parts.push(`    ticketId: {
      enabled: true,
      pattern: "${options.ticketId.pattern}",
      required: ${options.ticketId.required},
    },`);
    }

    commitSection = `
  commit: {
${parts.join("\n")}
  },`;
  }

  // Add comment about auto-detected semantic.yml
  const semanticComment = options.useSemanticYaml
    ? "\n  // Note: semantic.yml is auto-detected and loaded automatically"
    : "";

  return `/**
 * sg CLI configuration
 * https://github.com/falconiere/smart-scripts
 */
import type { SgConfig } from "smart-scripts";

export default {
  git: {
    baseBranch: "${options.baseBranch}",
    forceWithLease: ${options.forceWithLease},
  },
  ai: {
    model: "${options.model}",
    cacheEnabled: ${options.cacheEnabled},
  },
  output: {
    colors: ${options.colors},
  },${commitSection}${semanticComment}
} satisfies Partial<SgConfig>;
`;
};

const detectDefaultBranch = async (): Promise<string> => {
  try {
    const { stdout } = await runCommand(["git", "remote", "show", "origin"], {
      silent: true,
      ignoreExitCode: true,
    });
    const match = stdout.match(/HEAD branch: (\S+)/);
    if (match) return match[1];
  } catch {
    // Ignore
  }
  return "main";
};

const isGitRepo = async (): Promise<boolean> => {
  try {
    await runCommand(["git", "rev-parse", "--is-inside-work-tree"], { silent: true });
    return true;
  } catch {
    return false;
  }
};

const initCommand: CommandModule<object, InitCommandArgs> = {
  command: "init",
  describe: "Interactive setup wizard for sg configuration",
  builder: (yargs) => {
    return yargs
      .option("global", {
        alias: "g",
        type: "boolean",
        description: "Create global config (~/.config/sg/config.ts)",
        default: false,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        description: "Overwrite existing config file",
        default: false,
      })
      .example("$0 init", "Interactive setup for current project")
      .example("$0 init --global", "Setup global configuration");
  },
  handler: async (argv: ArgumentsCamelCase<InitCommandArgs>) => {
    // Validate arguments with Zod
    const args = InitArgsSchema.parse(argv);

    const paths = getConfigPaths();
    const isGlobal = args.global;
    const configPath = isGlobal ? paths.global : paths.project;
    const configDir = isGlobal ? paths.globalDir : getProjectRoot();

    console.clear();

    p.intro(`${color.bgCyan(color.black(" sg "))} ${color.dim(`v${VERSION}`)} ${color.cyan("— Setup Wizard")}`);

    // Check for existing config
    if (existsSync(configPath) && !args.force) {
      p.note(
        `Config already exists at:\n${color.dim(configPath)}`,
        "Existing Configuration"
      );

      const overwrite = await p.confirm({
        message: "Overwrite existing configuration?",
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Setup cancelled. Use --force to overwrite.");
        process.exit(0);
      }
    }

    const configType = isGlobal ? "global" : "project";
    p.log.info(`Creating ${color.cyan(configType)} configuration at ${color.dim(configPath)}`);

    // Detect git info
    const inGitRepo = await isGitRepo();
    const detectedBranch = inGitRepo ? await detectDefaultBranch() : "main";

    // Main configuration prompts
    const baseBranchChoice = await p.select({
      message: "What is your base/main branch?",
      initialValue: detectedBranch,
      options: [
        { value: "main", label: "main", hint: "default for new repos" },
        { value: "master", label: "master", hint: "legacy default" },
        { value: "develop", label: "develop", hint: "GitFlow style" },
        { value: "development", label: "development", hint: "alternative" },
        { value: "__custom__", label: "Other...", hint: "enter custom name" },
      ],
    });

    if (p.isCancel(baseBranchChoice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    let baseBranch = baseBranchChoice as string;
    if (baseBranchChoice === "__custom__") {
      const customBranch = await p.text({
        message: "Enter your base branch name:",
        placeholder: "e.g., main, master, develop",
        validate: (value) => {
          if (!value.trim()) return "Branch name is required";
          if (!/^[a-zA-Z0-9_\-/.]+$/.test(value)) return "Invalid branch name";
        },
      });

      if (p.isCancel(customBranch)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      baseBranch = customBranch as string;
    }

    const forceWithLease = await p.confirm({
      message: "Use --force-with-lease for safe force pushes?",
      initialValue: true,
    });

    if (p.isCancel(forceWithLease)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    const modelChoice = await p.select({
      message: "Which AI model do you want to use?",
      initialValue: DEFAULT_MODEL_TIERS.medium,
      options: [
        {
          value: DEFAULT_MODEL_TIERS.medium,
          label: "Claude Haiku 4.5",
          hint: "fast & affordable ⚡ (recommended)",
        },
        {
          value: DEFAULT_MODEL_TIERS.max,
          label: "Claude Sonnet 4.5",
          hint: "most capable",
        },
        {
          value: DEFAULT_MODEL_TIERS.small,
          label: "Claude Haiku 4",
          hint: "cheapest option",
        },
        {
          value: "openai/gpt-4o-mini",
          label: "GPT-4o Mini",
          hint: "OpenAI alternative",
        },
        {
          value: "openai/gpt-4o",
          label: "GPT-4o",
          hint: "OpenAI flagship",
        },
        {
          value: "google/gemini-flash-1.5",
          label: "Gemini 1.5 Flash",
          hint: "Google alternative",
        },
        {
          value: "__custom__",
          label: "Other...",
          hint: "enter custom model ID",
        },
      ],
    });

    if (p.isCancel(modelChoice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    let model = modelChoice as string;
    if (modelChoice === "__custom__") {
      p.note(
        `Find available models at:\n${color.underline("https://openrouter.ai/models")}`,
        "OpenRouter Models"
      );

      const customModel = await p.text({
        message: "Enter the model ID:",
        placeholder: "e.g., anthropic/claude-3-opus",
        validate: (value) => {
          if (!value.trim()) return "Model ID is required";
          if (!value.includes("/")) return "Model ID should be in format: provider/model-name";
        },
      });

      if (p.isCancel(customModel)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      model = customModel as string;
    }

    const cacheEnabled = await p.confirm({
      message: "Enable prompt caching to reduce API costs?",
      initialValue: true,
    });

    if (p.isCancel(cacheEnabled)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    const colors = await p.confirm({
      message: "Enable colored output?",
      initialValue: true,
    });

    if (p.isCancel(colors)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    // Detect existing templates (only for project config, not global)
    let useSemanticYaml = false;
    let useCommitTemplate: string | undefined;
    let ticketIdConfig: { enabled: boolean; pattern: string; required: boolean } | undefined;

    if (!isGlobal) {
      const templates = detectTemplates();
      const hasTemplates = templates.semanticYaml || templates.commitTemplate || templates.prTemplate;

      if (hasTemplates) {
        p.log.info("Detected existing templates in your project:");

        const templateList: string[] = [];
        if (templates.semanticYaml) {
          templateList.push(`  ${color.green("✓")} ${color.dim(templates.semanticYaml.path)} - ${templates.semanticYaml.types.length} types, ${templates.semanticYaml.scopes.length} scopes`);
        }
        if (templates.commitTemplate) {
          templateList.push(`  ${color.green("✓")} ${color.dim(templates.commitTemplate)} - commit message template`);
        }
        if (templates.prTemplate) {
          templateList.push(`  ${color.green("✓")} ${color.dim(templates.prTemplate)} - PR template`);
        }

        p.note(templateList.join("\n"), "Detected Templates");

        // Ask about semantic.yml
        if (templates.semanticYaml) {
          const useSemantic = await p.confirm({
            message: `Use types/scopes from ${templates.semanticYaml.path}?`,
            initialValue: true,
          });

          if (p.isCancel(useSemantic)) {
            p.cancel("Setup cancelled.");
            process.exit(0);
          }

          useSemanticYaml = useSemantic as boolean;

          if (useSemanticYaml) {
            p.log.success(`Will use ${templates.semanticYaml.types.length} types and ${templates.semanticYaml.scopes.length} scopes from semantic.yml`);
          }
        }

        // Ask about commit template
        if (templates.commitTemplate) {
          const useTemplate = await p.confirm({
            message: `Use ${templates.commitTemplate} as commit message template?`,
            initialValue: true,
          });

          if (p.isCancel(useTemplate)) {
            p.cancel("Setup cancelled.");
            process.exit(0);
          }

          if (useTemplate) {
            useCommitTemplate = templates.commitTemplate;
          }
        }

        // Ask about ticket ID if PR template exists
        if (templates.prTemplate) {
          const detectedPattern = detectTicketPattern(templates.prTemplate);

          const enableTicket = await p.confirm({
            message: "Enable ticket ID detection from branch names?",
            initialValue: !!detectedPattern,
          });

          if (p.isCancel(enableTicket)) {
            p.cancel("Setup cancelled.");
            process.exit(0);
          }

          if (enableTicket) {
            let ticketPattern = detectedPattern ?? "[A-Z]{2,10}-\\\\d+";

            if (detectedPattern) {
              p.log.info(`Detected ticket pattern: ${color.cyan(detectedPattern.replace(/\\\\/g, "\\"))}`);

              const useDetected = await p.confirm({
                message: "Use this pattern?",
                initialValue: true,
              });

              if (p.isCancel(useDetected)) {
                p.cancel("Setup cancelled.");
                process.exit(0);
              }

              if (!useDetected) {
                const customPattern = await p.text({
                  message: "Enter ticket ID regex pattern:",
                  placeholder: "e.g., JIRA-\\d+, PROJ-\\d+",
                  initialValue: "[A-Z]{2,10}-\\d+",
                });

                if (p.isCancel(customPattern)) {
                  p.cancel("Setup cancelled.");
                  process.exit(0);
                }
                ticketPattern = (customPattern as string).replace(/\\/g, "\\\\");
              }
            } else {
              const customPattern = await p.text({
                message: "Enter ticket ID regex pattern:",
                placeholder: "e.g., JIRA-\\d+, PROJ-\\d+",
                initialValue: "[A-Z]{2,10}-\\d+",
              });

              if (p.isCancel(customPattern)) {
                p.cancel("Setup cancelled.");
                process.exit(0);
              }
              ticketPattern = (customPattern as string).replace(/\\/g, "\\\\");
            }

            const requireTicket = await p.confirm({
              message: "Require ticket ID in commit messages?",
              initialValue: true,
            });

            if (p.isCancel(requireTicket)) {
              p.cancel("Setup cancelled.");
              process.exit(0);
            }

            ticketIdConfig = {
              enabled: true,
              pattern: ticketPattern,
              required: requireTicket as boolean,
            };
          }
        }
      }
    }

    const config: ConfigOptions = {
      baseBranch: baseBranch as string,
      forceWithLease: forceWithLease as boolean,
      model: model as string,
      cacheEnabled: cacheEnabled as boolean,
      colors: colors as boolean,
      useSemanticYaml,
      useCommitTemplate,
      ticketId: ticketIdConfig,
    };

    // API Key check
    const hasApiKey = !!process.env.OPENROUTER_API_KEY;

    if (!hasApiKey) {
      p.log.warn("OPENROUTER_API_KEY not found in environment");
      p.note(
        `Add to your shell profile (~/.zshrc or ~/.bashrc):\n\n${color.cyan('export OPENROUTER_API_KEY="your-key-here"')}\n\nGet your key at: ${color.underline("https://openrouter.ai/keys")}`,
        "API Key Required"
      );
    } else {
      p.log.success("OPENROUTER_API_KEY found in environment");
    }

    // Summary
    let summary = `
${color.dim("Location:")}       ${configPath}
${color.dim("Base Branch:")}    ${config.baseBranch}
${color.dim("Force w/Lease:")}  ${config.forceWithLease ? "Yes" : "No"}
${color.dim("AI Model:")}       ${config.model}
${color.dim("Caching:")}        ${config.cacheEnabled ? "Enabled" : "Disabled"}
${color.dim("Colors:")}         ${config.colors ? "Enabled" : "Disabled"}`;

    // Add commit config to summary
    if (config.useSemanticYaml) {
      summary += `\n${color.dim("Semantic YAML:")}  Auto-detected`;
    }
    if (config.useCommitTemplate) {
      summary += `\n${color.dim("Template:")}       ${config.useCommitTemplate}`;
    }
    if (config.ticketId?.enabled) {
      summary += `\n${color.dim("Ticket ID:")}      ${config.ticketId.required ? "Required" : "Optional"} (${config.ticketId.pattern.replace(/\\\\/g, "\\")})`;
    }

    p.note(summary.trim(), "Configuration Summary");

    const confirmed = await p.confirm({
      message: "Create configuration file?",
      initialValue: true,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    // Create config with spinner
    const s = p.spinner();
    s.start("Creating configuration file...");

    try {
      // Ensure directory exists
      if (isGlobal && !existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      const configContent = generateConfigContent(config);

      await writeFile(configPath, configContent, "utf-8");
      await setTimeout(500); // Brief pause for effect

      s.stop("Configuration file created!");
    } catch (error) {
      s.stop("Failed to create configuration file");
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    // Next steps
    const nextSteps = hasApiKey
      ? `Try generating a commit message:\n${color.cyan("sg commit --dry-run")}`
      : `1. Set your API key:\n   ${color.cyan('export OPENROUTER_API_KEY="your-key"')}\n\n2. Try generating a commit message:\n   ${color.cyan("sg commit --dry-run")}`;

    p.note(nextSteps, "Next Steps");

    p.outro(`${color.green("✓")} Setup complete! Run ${color.cyan("sg --help")} to see all commands.`);
  },
};

export default initCommand;
