# sg - Smart Git CLI

AI-powered git workflow CLI that generates conventional commit messages, automates rebasing, and streamlines your git workflow.

## Features

- **AI Commit Messages** - Generate conventional commit messages using Claude AI
- **Smart Push** - Full workflow: stage, lint, commit, rebase, push, create PR
- **Smart Squash** - Squash branch commits with AI-generated summary
- **Smart Rebase** - Safe rebasing with conflict handling
- **Token Tracking** - Monitor OpenRouter API usage and costs
- **Type Safety** - Full TypeScript with Zod validation

## Installation

```bash
# Using npm
npm install -g smart-scripts

# Using bun
bun add -g smart-scripts
```

### Requirements

- [Bun](https://bun.sh) runtime
- [OpenRouter API key](https://openrouter.ai/keys) for AI features
- Git

## Quick Start

```bash
# Set your OpenRouter API key
export OPENROUTER_API_KEY="your-key-here"

# Run the interactive setup wizard
sg init

# Generate a commit message
sg commit

# Full workflow: stage, commit, rebase, push
sg push -y

# Squash all branch commits
sg squash -y

# Rebase against main
sg rebase -b main
```

## Commands

### `sg init`

Interactive setup wizard that guides you through configuring sg.

```bash
sg init              # Setup for current project (creates sg.config.ts)
sg init --global     # Setup global config (~/.config/sg/config.ts)
sg init --force      # Overwrite existing config
```

The wizard will help you configure:
- Base branch (main, master, develop, etc.)
- AI model selection (Claude, GPT-4, etc.)
- Push behavior (force-with-lease)
- Output preferences (colors)

### `sg commit [action]`

Generate AI-powered commit messages following conventional commit format.

```bash
sg commit              # Generate message, save to .git/COMMIT_MSG_GENERATED
sg commit commit       # Generate and auto-commit
sg commit --dry-run    # Preview without changes
```

### `sg push [stageMode]`

Full git workflow: stage, commit, rebase, push.

```bash
sg push                 # Stage all, commit, rebase, push
sg push -y              # Auto-confirm all prompts
sg push tracked         # Only stage tracked files
sg push --skip-rebase   # Skip rebase step
sg push --skip-pr       # Skip PR creation
sg push --dry-run       # Preview workflow
```

**Options:**
- `--skip-push` - Don't push after committing
- `--skip-rebase` - Skip automatic rebase
- `--skip-pr` - Skip automatic PR creation
- `--pr-draft` - Create PR as draft
- `-y, --yes` - Auto-confirm all prompts
- `-c, --confirm` - Require confirmation

### `sg squash`

Squash branch commits with AI-generated summary message.

```bash
sg squash               # Squash and push
sg squash -y            # Auto-confirm
sg squash --base main   # Squash commits since main
sg squash --skip-push   # Squash without pushing
sg squash -e            # Edit message before committing
```

### `sg rebase`

Intelligent git rebasing with conflict handling.

```bash
sg rebase               # Rebase against base branch
sg rebase -b main       # Rebase against main
sg rebase -i            # Interactive rebase
sg rebase -y            # Auto-confirm
```

### `sg token [command]`

Track OpenRouter API usage and costs.

```bash
sg token                # Show summary report
sg token watch          # Live monitoring
sg token detailed       # Detailed session report
sg token csv            # Export as CSV
sg token clear          # Clear usage data
```

## Configuration

### Config Files

sg supports configuration files in TypeScript:

**Per-project:** `sg.config.ts` in your project root
**Global:** `~/.config/sg/config.ts`

```typescript
// sg.config.ts
import type { SgConfig } from "smart-scripts";

export default {
  git: {
    baseBranch: "main",        // Base branch for rebasing
    forceWithLease: true,      // Use --force-with-lease when pushing
  },
  ai: {
    model: "anthropic/claude-3-5-haiku",
    cacheEnabled: true,
  },
  output: {
    verbose: false,
    colors: true,
  },
} satisfies Partial<SgConfig>;
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key (required) | - |
| `SG_MODEL` | AI model to use | `anthropic/claude-3-5-haiku` |
| `SG_BASE_BRANCH` | Base branch for rebasing | `main` |
| `SG_VERBOSE` | Enable verbose output | `0` |
| `NO_COLOR` | Disable colored output | `0` |

### Global Options

All commands support these options:

- `--verbose` - Show detailed output
- `-q, --quiet` - Suppress non-essential output
- `--json` - Output in JSON format
- `--dry-run` - Preview changes without executing
- `--no-color` - Disable colored output
- `-h, --help` - Show help
- `-V, --version` - Show version

## Development

```bash
# Clone the repo
git clone https://github.com/falconiere/smart-scripts.git
cd smart-scripts

# Install dependencies
bun install

# Run locally
bun run bin/sg.ts --help

# Type check
bun run typecheck

# Lint
bun run lint

# Run all checks
bun run check

# Link globally for testing
bun link
sg --help
```

### Project Structure

```
smart-scripts/
├── bin/
│   └── sg.ts                    # CLI entry point
├── src/
│   ├── cli/
│   │   └── commands/            # Yargs command modules
│   │       ├── init.ts
│   │       ├── commit.ts
│   │       ├── push.ts
│   │       ├── squash.ts
│   │       ├── rebase.ts
│   │       └── token.ts
│   ├── schemas/                 # Zod validation schemas
│   │   ├── config.ts
│   │   ├── cli.ts
│   │   └── index.ts
│   ├── smart-git-commit/
│   ├── smart-git-push/
│   ├── smart-git-squash/
│   ├── smart-git-rebase/
│   ├── smart-token-tracker/
│   └── utils/
├── package.json
├── tsconfig.json
└── oxlintrc.json
```

### Code Quality

- **TypeScript** - Strict type checking enabled
- **OxLint** - Fast linting with extensive rule set
- **Zod** - Runtime validation for config and CLI args

## License

MIT
