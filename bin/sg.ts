#!/usr/bin/env bun
/**
 * sg - Smart Git CLI
 *
 * AI-powered git workflow tools
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { VERSION, VERSION_DATE, loadConfig } from "@/utils/config.ts";
import { initOutput, parseOutputOptions } from "@/utils/output.ts";
import { ensureCacheIgnored } from "@/utils/common.ts";

// Import command modules
import initCommand from "@/cli/commands/init.ts";
import commitCommand from "@/cli/commands/commit.ts";
import pushCommand from "@/cli/commands/push.ts";
import squashCommand from "@/cli/commands/squash.ts";
import rebaseCommand from "@/cli/commands/rebase.ts";
import tokenCommand from "@/cli/commands/token.ts";

// Load config before running commands
await loadConfig();

// Ensure .cache is in .gitignore
await ensureCacheIgnored();

// biome-ignore lint/suspicious/noExplicitAny: yargs middleware typing
const initOutputMiddleware = (argv: any) => {
  const outputOpts = parseOutputOptions({
    verbose: argv.verbose,
    quiet: argv.quiet,
    json: argv.json,
    "dry-run": argv.dryRun,
    "no-color": argv.noColor,
  });
  initOutput(outputOpts);
};

await yargs(hideBin(process.argv))
  .scriptName("sg")
  .version(`${VERSION} (${VERSION_DATE})`)
  .usage("$0 <command> [options]")
  .command(initCommand)
  .command(commitCommand)
  .command(pushCommand)
  .command(squashCommand)
  .command(rebaseCommand)
  .command(tokenCommand)
  // Global options (available to all commands)
  .option("verbose", {
    type: "boolean",
    description: "Show detailed output",
    global: true,
  })
  .option("quiet", {
    alias: "q",
    type: "boolean",
    description: "Suppress non-essential output",
    global: true,
  })
  .option("json", {
    type: "boolean",
    description: "Output in JSON format",
    global: true,
  })
  .option("dry-run", {
    type: "boolean",
    description: "Preview changes without executing",
    global: true,
  })
  .option("no-color", {
    type: "boolean",
    description: "Disable colored output",
    global: true,
  })
  .middleware(initOutputMiddleware)
  .demandCommand(1, "You need at least one command. Run 'sg --help' for available commands.")
  .recommendCommands()
  .strict()
  .help()
  .alias("h", "help")
  .alias("V", "version")
  .epilogue("For more information, visit https://github.com/falconiere/smart-scripts")
  .parse();
