# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`sg` is an AI-powered git workflow CLI written in TypeScript for the Bun runtime. It automates common git workflows like commits, push, squash, and rebase using AI-generated commit messages.

### Import Aliases

The project uses TypeScript path aliases for cleaner imports:

| Alias | Path |
|-------|------|
| `@/*` | `src/*` |
| `@/cli/*` | `src/cli/*` |
| `@/schemas/*` | `src/schemas/*` |
| `@/utils/*` | `src/utils/*` |

**Examples:**
```typescript
// Instead of relative paths:
import { git } from "../../utils/common.ts";

// Use aliases:
import { git } from "@/utils/common.ts";
import { SomeSchema } from "@/schemas/cli.ts";
import someCommand from "@/cli/commands/some.ts";
```

## Running the CLI

```bash
# Global install (after npm link or npm install -g)
sg --help
sg commit
sg push -y

# Development
bun run bin/sg.ts --help
bun run bin/sg.ts commit --dry-run
```

## Development Commands

```bash
# Install dependencies
bun install

# Type check (strict TypeScript)
bun run typecheck

# Lint (OxLint)
bun run lint

# Run all checks
bun run check
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `sg init` | Interactive setup wizard for configuration |
| `sg commit` | Generate AI-powered conventional commit messages |
| `sg push` | Full git workflow: stage, commit, rebase, push |
| `sg squash` | Squash commits with AI-generated summary message |
| `sg rebase` | Safe rebase with automatic conflict handling |
| `sg token` | Track OpenRouter API usage and costs |

## Architecture

### Project Structure

```
smart-scripts/
├── bin/
│   └── sg.ts                 # CLI entry point (Yargs)
├── src/
│   ├── cli/
│   │   └── commands/         # Yargs command modules
│   │       ├── init.ts       # Interactive setup wizard
│   │       ├── commit.ts
│   │       ├── push.ts
│   │       ├── squash.ts
│   │       ├── rebase.ts
│   │       └── token.ts
│   ├── schemas/              # Zod validation schemas
│   │   ├── config.ts         # Configuration schema
│   │   ├── cli.ts            # CLI argument schemas
│   │   └── index.ts
│   ├── smart-git-commit/     # Commit generation logic
│   ├── smart-git-push/       # Push workflow logic
│   ├── smart-git-squash/     # Squash logic
│   ├── smart-git-rebase/     # Rebase logic
│   ├── smart-token-tracker/  # Token tracking
│   └── utils/                # Shared utilities
├── package.json
├── tsconfig.json             # Strict TypeScript config
└── oxlintrc.json            # OxLint configuration
```

### Shared Utilities (`src/utils/`)

- `common.ts` - Colors, logging, user interaction, git operations, command execution
- `openrouter.ts` - OpenRouter API client with model tiers (MAX/MEDIUM/SMALL) and caching
- `config.ts` - Configuration loading (global + per-project) with Zod validation
- `output.ts` - Output formatting, dry-run support, JSON output

### Key Patterns

**CLI Command Module** (`src/cli/commands/*.ts`):
```typescript
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { SomeArgsSchema } from "@/schemas/cli.ts";

interface SomeCommandArgs {
  option?: boolean;
}

const someCommand: CommandModule<object, SomeCommandArgs> = {
  command: "some [arg]",
  describe: "Description",
  builder: (yargs) => yargs.option("option", { type: "boolean" }),
  handler: async (argv: ArgumentsCamelCase<SomeCommandArgs>) => {
    const args = SomeArgsSchema.parse(argv);  // Zod validation
    // ... handler logic
  },
};
```

**Git Helper Object** (`@/utils/common.ts`):
```typescript
import { git } from "@/utils/common.ts";
await git.getCurrentBranch();
await git.hasStagedChanges();
await git.commit(message);
```

**OpenRouter API** (`@/utils/openrouter.ts`):
```typescript
import { callOpenRouter, createCachedMessage, createMessage, getModelForComplexity } from "@/utils/openrouter.ts";
const model = getModelForComplexity("MEDIUM");
const response = await callOpenRouter([
  createCachedMessage("System prompt..."),
  createMessage("User input...")
], { model, max_tokens: 500 });
```

**Zod Schema Validation** (`@/schemas/*.ts`):
```typescript
import { z } from "zod/v4";

export const SomeSchema = z.object({
  field: z.string().min(1),
  optional: z.boolean().default(false),
});

export type SomeType = z.infer<typeof SomeSchema>;
```

## MCP Tools for Documentation and Research

This project has access to Model Context Protocol (MCP) tools for retrieving up-to-date documentation and code examples. Use these tools when working with external libraries, APIs, or frameworks.

### Context7

Use Context7 for library-specific documentation and code examples. It provides high-quality, up-to-date documentation for libraries, SDKs, and APIs.

**Getting Library Documentation:**

1. First, resolve the library ID:
```typescript
// Resolve library name to Context7-compatible ID
mcp_context7_resolve-library-id({
  libraryName: "zod"  // or "yargs", "bun", etc.
})
```

The response will include a list of matching libraries with their Context7-compatible IDs. Select the most relevant one based on:
- Name similarity (exact matches prioritized)
- Description relevance
- Documentation coverage (higher Code Snippet counts preferred)
- Reputation (High/Medium reputation more authoritative)
- Benchmark Score (quality indicator, 100 is highest)

2. Then fetch the documentation:
```typescript
// Get library docs (use 'code' mode for API references, 'info' for guides)
mcp_context7_get-library-docs({
  context7CompatibleLibraryID: "/colinhacks/zod",  // from step 1 (format: /org/project or /org/project/version)
  mode: "code",  // "code" for API references/examples (default), "info" for conceptual guides
  topic: "validation",  // optional: focus on specific topic (e.g., "hooks", "routing")
  page: 1  // optional: pagination (1-10, default: 1) - increase if context is insufficient
})
```

**When to use Context7:**
- Working with external libraries (Zod, Yargs, Bun APIs)
- Need API references or code examples
- Looking for up-to-date documentation
- Best for library-specific queries

### Exa

Use Exa for web searches and code context retrieval. Exa-code provides high-quality context for programming tasks.

**Web Search:**
```typescript
mcp_exa_web_search_exa({
  query: "TypeScript strict mode best practices",
  numResults: 8,  // optional: number of results (default: 8)
  type: "auto",  // optional: "auto" (balanced, default), "fast" (quick), "deep" (comprehensive)
  livecrawl: "fallback"  // optional: "fallback" (use live as backup, default) or "preferred" (prioritize live)
})
```

**Code Context:**
```typescript
// Get relevant code context for APIs, libraries, and SDKs
mcp_exa_get_code_context_exa({
  query: "React useState hook examples",  // required: search query
  tokensNum: 5000  // optional: tokens to return (1000-50000, default: 5000) - adjust based on context needed
})
```

**When to use Exa:**
- General web searches for programming topics
- Finding code examples and tutorials
- Researching best practices or patterns
- Getting code context for specific APIs or libraries
- **Note:** For any code-related queries, Exa-code is preferred and should be used

**Exa Tool Selection:**
- Use `mcp_exa_get_code_context_exa` for code examples and API context (recommended for code tasks)
- Use `mcp_exa_web_search_exa` for general web searches and research

### Ref

Use Ref for searching documentation across web, GitHub, and private resources.

**Search Documentation:**
```typescript
mcp_Ref_ref_search_documentation({
  query: "TypeScript yargs command module patterns",
  // Query should include programming language and framework/library names
  // Optional: include ref_src=private in query to search private docs
})
```

The search returns URLs that can be read directly. Use `mcp_Ref_ref_read_url` to read the content.

**Read URL Content:**
```typescript
// Read content from URLs found in search results
mcp_Ref_ref_read_url({
  url: "https://example.com/docs/page#section"  // exact URL from search (including #hash if present)
})
```

**When to use Ref:**
- Searching documentation sites
- Finding GitHub documentation
- Looking for answers in public or private documentation repositories
- When you need to search across multiple documentation sources

### MCP Usage Guidelines

1. **For library documentation**: Use Context7 first (most comprehensive and up-to-date)
   - Start with `mcp_context7_resolve-library-id` to find the library
   - Then use `mcp_context7_get-library-docs` with the resolved ID
   - Use `mode: "code"` for API references, `mode: "info"` for guides
   - Increase `page` if initial results are insufficient

2. **For code examples and patterns**: Use Exa-code (`mcp_exa_get_code_context_exa`)
   - Preferred for code-related queries
   - Adjust `tokensNum` based on context needed (lower for focused, higher for comprehensive)

3. **For general research**: Use Exa web search (`mcp_exa_web_search_exa`) or Ref documentation search
   - Exa for general web searches
   - Ref for documentation-specific searches

4. **Always prefer MCP tools** over manual web searches when working with libraries, frameworks, or APIs

5. **Workflow example**:
   - Need library API docs? → Context7
   - Need code examples? → Exa-code
   - Need general research? → Exa web search
   - Need documentation search? → Ref

## Configuration

Configuration is loaded in priority order:
1. CLI flags (`sg push --skip-rebase`)
2. Environment variables (`SG_BASE_BRANCH=main`)
3. Per-project config (`./sg.config.ts`)
4. Global config (`~/.config/sg/config.ts`)
5. Defaults

**Example `sg.config.ts`:**
```typescript
import type { SgConfig } from "smart-scripts";

export default {
  git: {
    baseBranch: "main",
  },
  ai: {
    model: "anthropic/claude-haiku-4.5",
    // Optional: customize models for different task complexities
    modelTiers: {
      max: "anthropic/claude-sonnet-4-5",
      medium: "anthropic/claude-haiku-4.5",
      small: "anthropic/claude-haiku-4",
    },
  },
} satisfies Partial<SgConfig>;
```

## Code Quality

### TypeScript (Strict Mode)

The project uses strict TypeScript with these key settings:
- `strict: true` - All strict type checking
- `strictNullChecks: true` - Null/undefined checking
- `noImplicitAny: true` - No implicit any types

Run: `bun run typecheck`

### OxLint

Fast linting with extensive rules including TypeScript, Promise handling, and modern JS patterns.

Run: `bun run lint`

### Zod Validation

All CLI arguments and configuration are validated at runtime using Zod schemas in `src/schemas/`.

## Environment Variables

- `OPENROUTER_API_KEY` - Required for AI features (get from https://openrouter.ai/keys)
- `SG_MODEL` or `OPENROUTER_MODEL` - Model override
- `SG_BASE_BRANCH` - Base branch for rebasing (default: "main")
- `SG_VERBOSE` - Enable verbose output ("1")
- `NO_COLOR` - Disable colored output ("1")

## Model Tiers

Scripts use different AI models based on task complexity. Models are fully configurable via config files or environment variables.

**Default Models:**
- `MAX` (claude-sonnet-4-5): Complex analysis
- `MEDIUM` (claude-haiku-4.5): Commit messages, standard tasks (default)
- `SMALL` (claude-haiku-4): Simple formatting, high-volume operations

**Usage:**
```typescript
import { getModelForComplexity } from "@/utils/openrouter.ts";
const model = getModelForComplexity("MEDIUM");  // reads from config
```

**Priority:**
1. `OPENROUTER_MODEL` env var (global override)
2. `SG_MODEL_MAX` / `SG_MODEL_MEDIUM` / `SG_MODEL_SMALL` env vars
3. Config file `modelTiers` setting
4. Default model tiers

**Custom Model Tiers in `sg.config.ts`:**
```typescript
export default {
  ai: {
    model: "anthropic/claude-haiku-4.5",  // default model
    modelTiers: {
      max: "openai/gpt-4o",               // for complex tasks
      medium: "anthropic/claude-haiku-4.5", // for standard tasks
      small: "openai/gpt-4o-mini",        // for simple tasks
    },
  },
} satisfies Partial<SgConfig>;
```

## Token Tracking Configuration

The `sg token` command tracks API usage and calculates cost savings. **Pricing is automatically fetched from OpenRouter's API** for accurate, up-to-date values.

**Automatic Pricing:**
- Prices are fetched from `https://openrouter.ai/api/v1/models`
- Cached locally for 24 hours (in `.cache/openrouter-models.json`)
- Falls back to config values if API is unavailable

**Configuration in `sg.config.ts`:**
```typescript
export default {
  tracking: {
    enabled: true,
    usageFile: ".cache/token-usage.json",
    developerHourlyRate: 100,  // For ROI calculation

    // Optional: Override automatic pricing with custom values
    actualPricing: {
      name: "Claude Haiku 4.5 (OpenRouter)",
      inputPerMillion: 0.8,
      outputPerMillion: 4.0,
      cacheDiscount: 0.9,
    },

    // Optional: Custom comparison pricing
    comparisonPricing: {
      name: "Claude Sonnet 4.5 (Claude Code)",
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
      cacheDiscount: 0.9,
    },

    // Time estimates for ROI calculation (in minutes)
    timeEstimates: {
      gitCommit: 5,
      gitSquash: 10,
      tsFix: 15,
      auditCode: 30,
      auditDeps: 20,
      auditPatterns: 25,
      default: 10,
    },
  },
} satisfies Partial<SgConfig>;
```

**Pricing API Usage:**
```typescript
import { getModelPricing, searchModels } from "@/utils/openrouter-pricing.ts";

// Get pricing for a specific model
const pricing = await getModelPricing("anthropic/claude-haiku-4.5");
console.log(pricing);
// { name: "Claude 3.5 Haiku", inputPerMillion: 1.0, outputPerMillion: 5.0, cacheDiscount: 0.9 }

// Search for models
const models = await searchModels("claude");
```
