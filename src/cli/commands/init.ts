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

interface DetectedDevTool {
  name: string;
  configFile: string;
  command: string;
  hint: string;
}

interface DetectedDevTools {
  linters: DetectedDevTool[];
  typecheckers: DetectedDevTool[];
  lintStaged: DetectedDevTool | null;
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
 * Detect linting, formatting, and typecheck tools in the project
 */
const detectDevTools = (): DetectedDevTools => {
  const root = getProjectRoot();
  const result: DetectedDevTools = {
    linters: [],
    typecheckers: [],
    lintStaged: null,
  };

  // Try to read package.json for scripts
  let packageJson: { scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> } = {};
  const packagePath = join(root, "package.json");
  if (existsSync(packagePath)) {
    try {
      packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
    } catch {
      // Ignore parse errors
    }
  }

  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const scripts = packageJson.scripts ?? {};

  // Detect Biome
  const biomeConfigs = ["biome.json", "biome.jsonc"];
  for (const config of biomeConfigs) {
    if (existsSync(join(root, config)) || deps["@biomejs/biome"]) {
      result.linters.push({
        name: "Biome",
        configFile: config,
        command: "npx biome check --write",
        hint: "fast linter & formatter",
      });
      break;
    }
  }

  // Detect ESLint
  const eslintConfigs = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml", ".eslintrc"];
  for (const config of eslintConfigs) {
    if (existsSync(join(root, config)) || deps.eslint) {
      result.linters.push({
        name: "ESLint",
        configFile: config,
        command: "npx eslint --fix",
        hint: "popular JavaScript linter",
      });
      break;
    }
  }

  // Detect OxLint
  if (existsSync(join(root, "oxlintrc.json")) || deps.oxlint) {
    result.linters.push({
      name: "OxLint",
      configFile: "oxlintrc.json",
      command: "npx oxlint",
      hint: "fast Rust-based linter",
    });
  }

  // Detect Prettier
  const prettierConfigs = ["prettier.config.js", "prettier.config.mjs", "prettier.config.cjs", ".prettierrc", ".prettierrc.js", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml"];
  for (const config of prettierConfigs) {
    if (existsSync(join(root, config)) || deps.prettier) {
      result.linters.push({
        name: "Prettier",
        configFile: config,
        command: "npx prettier --write",
        hint: "code formatter",
      });
      break;
    }
  }

  // Detect TypeScript
  if (existsSync(join(root, "tsconfig.json")) || deps.typescript) {
    result.typecheckers.push({
      name: "TypeScript",
      configFile: "tsconfig.json",
      command: "npx tsc --noEmit",
      hint: "type checking",
    });
  }

  // Detect lint-staged
  const lintStagedConfigs = ["lint-staged.config.js", "lint-staged.config.mjs", "lint-staged.config.cjs", ".lintstagedrc", ".lintstagedrc.js", ".lintstagedrc.json", ".lintstagedrc.yml", ".lintstagedrc.yaml"];
  for (const config of lintStagedConfigs) {
    if (existsSync(join(root, config)) || deps["lint-staged"]) {
      result.lintStaged = {
        name: "lint-staged",
        configFile: config,
        command: "npx lint-staged",
        hint: "runs linters on staged files",
      };
      break;
    }
  }

  // Check for lint-staged in package.json
  if (!result.lintStaged && packageJson && "lint-staged" in packageJson) {
    result.lintStaged = {
      name: "lint-staged",
      configFile: "package.json",
      command: "npx lint-staged",
      hint: "runs linters on staged files",
    };
  }

  // Also check for common npm scripts
  if (scripts.lint && !result.linters.some((l) => l.name === "npm script")) {
    result.linters.push({
      name: "npm run lint",
      configFile: "package.json",
      command: "npm run lint",
      hint: "project's lint script",
    });
  }

  if (scripts.typecheck && !result.typecheckers.some((t) => t.name === "npm script")) {
    result.typecheckers.push({
      name: "npm run typecheck",
      configFile: "package.json",
      command: "npm run typecheck",
      hint: "project's typecheck script",
    });
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
  // Git options
  lintStagedCmd?: string | false;
  syncStrategy?: "rebase" | "merge" | "none";
  autoSync?: boolean;
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

  // Build git section with optional settings
  const gitLines: string[] = [];
  if (options.lintStagedCmd) {
    gitLines.push(`    lintStagedCmd: "${options.lintStagedCmd}",`);
  }
  if (options.syncStrategy && options.syncStrategy !== "none") {
    gitLines.push(`    syncStrategy: "${options.syncStrategy}",`);
    gitLines.push(`    autoSync: ${options.autoSync ?? false},`);
  }
  const extraGitLines = gitLines.length > 0 ? `\n${gitLines.join("\n")}` : "";

  return `/**
 * sg CLI configuration
 * https://github.com/falconiere/smart-scripts
 */
import type { SgConfig } from "smart-scripts";

export default {
  git: {
    baseBranch: "${options.baseBranch}",
    forceWithLease: ${options.forceWithLease},${extraGitLines}
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

    // Sync strategy selection
    const syncStrategyChoice = await p.select({
      message: "How do you want to sync with the base branch?",
      initialValue: "none" as const,
      options: [
        {
          value: "none" as const,
          label: "None",
          hint: "don't automatically sync",
        },
        {
          value: "rebase" as const,
          label: "Rebase",
          hint: "rebase onto base branch (cleaner history)",
        },
        {
          value: "merge" as const,
          label: "Merge",
          hint: "merge from base branch (preserves history)",
        },
      ],
    });

    if (p.isCancel(syncStrategyChoice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    let syncStrategy = syncStrategyChoice as "rebase" | "merge" | "none";
    let autoSync = false;

    // If a sync strategy is selected, ask about auto-sync
    if (syncStrategy !== "none") {
      const autoSyncChoice = await p.confirm({
        message: `Automatically ${syncStrategy} from ${baseBranch} before commits?`,
        initialValue: true,
      });

      if (p.isCancel(autoSyncChoice)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      autoSync = autoSyncChoice as boolean;

      if (autoSync) {
        p.log.success(`Will automatically ${syncStrategy} from ${baseBranch} before each commit`);
      }
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

    // Detect dev tools (only for project config, not global)
    let lintStagedCmd: string | false | undefined;

    if (!isGlobal) {
      const devTools = detectDevTools();
      const hasDevTools = devTools.linters.length > 0 || devTools.typecheckers.length > 0 || devTools.lintStaged;

      if (hasDevTools) {
        p.log.info("Detected development tools in your project:");

        const toolsList: string[] = [];
        for (const tool of devTools.linters) {
          toolsList.push(`  ${color.green("✓")} ${color.cyan(tool.name)} - ${tool.hint}`);
        }
        for (const tool of devTools.typecheckers) {
          toolsList.push(`  ${color.green("✓")} ${color.cyan(tool.name)} - ${tool.hint}`);
        }
        if (devTools.lintStaged) {
          toolsList.push(`  ${color.green("✓")} ${color.cyan(devTools.lintStaged.name)} - ${devTools.lintStaged.hint}`);
        }

        p.note(toolsList.join("\n"), "Detected Dev Tools");

        // Build options for lint command selection
        const lintOptions: { value: string | false; label: string; hint?: string }[] = [
          { value: false, label: "None", hint: "don't run any linting" },
        ];

        // Prioritize lint-staged if available
        if (devTools.lintStaged) {
          lintOptions.unshift({
            value: devTools.lintStaged.command,
            label: devTools.lintStaged.name,
            hint: `${devTools.lintStaged.hint} (recommended)`,
          });
        }

        // Add individual linters
        for (const tool of devTools.linters) {
          lintOptions.push({
            value: tool.command,
            label: tool.name,
            hint: tool.hint,
          });
        }

        // Add custom option
        lintOptions.push({
          value: "__custom__",
          label: "Custom command...",
          hint: "enter your own lint command",
        });

        const lintChoice = await p.select({
          message: "Run a lint/format command before commits?",
          initialValue: devTools.lintStaged?.command ?? false,
          options: lintOptions,
        });

        if (p.isCancel(lintChoice)) {
          p.cancel("Setup cancelled.");
          process.exit(0);
        }

        if (lintChoice === "__custom__") {
          const customCmd = await p.text({
            message: "Enter your lint command:",
            placeholder: "e.g., npm run lint, npx eslint --fix",
            validate: (value) => {
              if (!value.trim()) return "Command is required";
            },
          });

          if (p.isCancel(customCmd)) {
            p.cancel("Setup cancelled.");
            process.exit(0);
          }
          lintStagedCmd = customCmd as string;
        } else {
          lintStagedCmd = lintChoice as string | false;
        }

        if (lintStagedCmd) {
          p.log.success(`Will run: ${color.cyan(lintStagedCmd)} before commits`);
        }
      }
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
      lintStagedCmd: lintStagedCmd ?? false,
      syncStrategy,
      autoSync,
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

    // Add lint command to summary
    if (config.lintStagedCmd) {
      summary += `\n${color.dim("Lint Command:")}   ${config.lintStagedCmd}`;
    }

    // Add sync strategy to summary
    if (config.syncStrategy && config.syncStrategy !== "none") {
      const syncMode = config.autoSync ? "Auto" : "Manual";
      summary += `\n${color.dim("Sync Strategy:")}  ${config.syncStrategy} (${syncMode})`;
    }

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
