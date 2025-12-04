/**
 * sg token - Track OpenRouter API usage and costs
 *
 * Fetches real-time pricing from OpenRouter API for accurate cost calculations.
 */
import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { readFile } from "node:fs/promises";

import { COLORS, colorize, logger } from "@/utils/common.ts";
import {
  fetchActualPricing,
  fetchComparisonPricing,
  getDeveloperHourlyRate,
} from "@/smart-token-tracker/config.ts";
import { clearData, getSessions, getTokenUsageFile, getUsageStats } from "@/smart-token-tracker/index.ts";
import type { UsageData } from "@/smart-token-tracker/types.ts";
import { calculateTimeSavings, formatCurrency, formatDuration, formatNumber } from "@/smart-token-tracker/utils.ts";
import { TokenArgsSchema } from "@/schemas/cli.ts";

interface TokenCommandArgs {
  command?: string;
  days?: number;
  interval?: number;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  dryRun?: boolean;
  noColor?: boolean;
}

const tokenCommand: CommandModule<object, TokenCommandArgs> = {
  command: "token [command]",
  describe: "Track OpenRouter API usage and costs",
  builder: (yargs) => {
    return yargs
      .positional("command", {
        describe: "Subcommand to run",
        choices: ["summary", "watch", "detailed", "csv", "clear"] as const,
        default: "summary",
        type: "string",
      })
      .option("days", {
        alias: "d",
        type: "number",
        default: 30,
        description: "Number of days to include in report",
      })
      .option("interval", {
        alias: "i",
        type: "number",
        default: 5,
        description: "Watch mode refresh interval in seconds",
      })
      .example("$0 token", "Show summary report")
      .example("$0 token watch", "Live view with real-time updates")
      .example("$0 token detailed --days 7", "Detailed report for last 7 days")
      .example("$0 token csv", "Export data as CSV");
  },
  handler: async (argv: ArgumentsCamelCase<TokenCommandArgs>) => {
    // Validate arguments with Zod
    const args = TokenArgsSchema.parse(argv);

    const command = args.command ?? "summary";
    const days = args.days;
    const intervalSec = args.interval;

    if (command === "clear") {
      await clearData();
      process.exit(0);
    }

    // Fetch real pricing from OpenRouter API (cached for 24h)
    const [actualPricing, comparisonPricing] = await Promise.all([
      fetchActualPricing(),
      fetchComparisonPricing(),
    ]);
    const hourlyRate = getDeveloperHourlyRate();

    if (command === "watch") {
      logger.header(`Token Usage Monitor (Refreshing every ${intervalSec}s)`);
      console.log(`${COLORS.dim}Press Ctrl+C to exit${COLORS.reset}\n`);
      console.log(`${COLORS.dim}Pricing: ${actualPricing.name} ($${actualPricing.inputPerMillion.toFixed(2)}/$${actualPricing.outputPerMillion.toFixed(2)} per M)${COLORS.reset}\n`);

      const showLiveStats = async (): Promise<void> => {
        // Clear screen
        process.stdout.write("\x1b[2J\x1b[0f");

        const stats = await getUsageStats(days);
        const sessions = await getSessions(days);

        if (!stats || sessions.length === 0) {
          console.log(`${COLORS.dim}Waiting for data...${COLORS.reset}`);
          return;
        }

        const savings = calculateTimeSavings(stats, sessions, {
          actualPricing,
          comparisonPricing,
          hourlyRate,
        });

        console.log(`${COLORS.blue}═══ Token Usage Monitor (Last ${days} days) ═══${COLORS.reset}`);
        console.log(`${COLORS.dim}Updated: ${new Date().toLocaleTimeString()}${COLORS.reset}\n`);

        console.log(`${COLORS.yellow}Overview${COLORS.reset}`);
        console.log(`${COLORS.dim}────────────────────────────────────${COLORS.reset}`);
        const cacheRate = stats.total_tokens > 0 ? ((stats.cached_tokens / stats.total_tokens) * 100).toFixed(1) : "0";
        console.log(`  Sessions:     ${colorize("green", formatNumber(stats.total_sessions))}`);
        console.log(`  Tokens:       ${formatNumber(stats.total_tokens)} (${colorize("green", `${cacheRate}% cached`)})`);
        console.log(`  Cost:         ${colorize("cyan", formatCurrency(stats.total_cost))}\n`);

        console.log(`${COLORS.yellow}Savings vs ${comparisonPricing.name}${COLORS.reset}`);
        console.log(`${COLORS.dim}────────────────────────────────────${COLORS.reset}`);
        console.log(`  Comparison:    ${colorize("red", formatCurrency(savings.alternative_cost))} (would have paid)`);
        console.log(`  Actual:        ${colorize("cyan", formatCurrency(savings.actual_cost))} (${actualPricing.name})`);
        console.log(`  Financial:     ${colorize("green", `+${formatCurrency(savings.total_savings)}`)} saved`);
        console.log(`  Cache:         ${colorize("green", `+${formatCurrency(savings.cache_savings)}`)} saved`);
        console.log(`  Time:          ${colorize("green", formatDuration(savings.time_saved_minutes))} saved`);
        console.log(`  Value:         ${colorize("green", formatCurrency(savings.value_generated))} @ $${hourlyRate}/hr`);
        const roiDisplay = savings.roi_multiplier === Infinity ? "∞" : `${savings.roi_multiplier.toFixed(1)}x`;
        console.log(`  ROI:           ${colorize("green", roiDisplay)}\n`);

        console.log(`${COLORS.yellow}Top Scripts${COLORS.reset}`);
        console.log(`${COLORS.dim}────────────────────────────────────${COLORS.reset}`);
        const topScripts = stats.by_script.sort((a, b) => b.sessions - a.sessions).slice(0, 5);

        for (const s of topScripts) {
          console.log(`  ${s.script}: ${s.sessions} sessions (${formatCurrency(s.cost)})`);
        }
        console.log("");
      };

      await showLiveStats();

      const intervalId = setInterval(() => {
        void showLiveStats();
      }, intervalSec * 1000);

      process.on("SIGINT", () => {
        clearInterval(intervalId);
        console.log(`\n${COLORS.dim}Monitor stopped.${COLORS.reset}`);
        process.exit(0);
      });

      await new Promise(() => {});
    }

    const stats = await getUsageStats(days);
    const sessions = await getSessions(days);

    if (!stats || sessions.length === 0) {
      logger.warn(`No usage data available in the last ${days} days.`);
      process.exit(0);
    }

    const savings = calculateTimeSavings(stats, sessions, {
      actualPricing,
      comparisonPricing,
      hourlyRate,
    });

    if (command === "summary") {
      logger.header(`Token Usage Report (Last ${days} days)`);

      // Show pricing source
      console.log(`${COLORS.dim}Pricing from OpenRouter API (cached 24h)${COLORS.reset}`);
      console.log(`${COLORS.dim}  Actual: ${actualPricing.name} - $${actualPricing.inputPerMillion.toFixed(2)}/$${actualPricing.outputPerMillion.toFixed(2)} per M tokens${COLORS.reset}`);
      console.log(`${COLORS.dim}  Compare: ${comparisonPricing.name} - $${comparisonPricing.inputPerMillion.toFixed(2)}/$${comparisonPricing.outputPerMillion.toFixed(2)} per M tokens${COLORS.reset}`);
      console.log("");

      console.log(`${COLORS.yellow}Overall Statistics${COLORS.reset}`);
      console.log(`${COLORS.dim}──────────────────────────────────────────────${COLORS.reset}`);
      console.log(`  Sessions:           ${colorize("green", formatNumber(stats.total_sessions))}`);
      console.log(`  Total tokens:       ${formatNumber(stats.total_tokens)}`);
      console.log(`  Effective tokens:   ${formatNumber(stats.effective_tokens)}`);
      const cacheRate = stats.total_tokens > 0 ? ((stats.cached_tokens / stats.total_tokens) * 100).toFixed(1) : "0";
      console.log(`  Cached tokens:      ${colorize("green", formatNumber(stats.cached_tokens))} (${cacheRate}%)`);
      console.log(`  Total cost:         ${colorize("cyan", formatCurrency(stats.total_cost))}`);
      console.log("");

      console.log(`${COLORS.yellow}Usage by Script${COLORS.reset}`);
      console.log(`${COLORS.dim}──────────────────────────────────────────────${COLORS.reset}`);
      for (const s of stats.by_script) {
        console.log(`  ${s.script}:`);
        console.log(`    Sessions: ${s.sessions}`);
        console.log(`    Tokens:   ${formatNumber(s.total_tokens)} (cached: ${formatNumber(s.cached_tokens)})`);
        console.log(`    Cost:     ${formatCurrency(s.cost)}`);
        console.log("");
      }

      console.log(`${COLORS.yellow}Savings Analysis${COLORS.reset}`);
      console.log(`${COLORS.dim}──────────────────────────────────────────────${COLORS.reset}`);
      console.log(`  ${COLORS.dim}Comparison: ${actualPricing.name} vs ${comparisonPricing.name}${COLORS.reset}`);
      console.log(
        `  Comparison cost:      ${colorize("red", formatCurrency(savings.alternative_cost))} (would have paid)`
      );
      console.log(`  Actual cost:          ${colorize("cyan", formatCurrency(savings.actual_cost))}`);
      console.log(`  Model savings:        ${colorize("green", `+${formatCurrency(savings.total_savings)}`)}`);
      console.log(`  Cache savings:        ${colorize("green", `+${formatCurrency(savings.cache_savings)}`)}`);
      console.log(
        `  Total financial:      ${colorize("green", `+${formatCurrency(savings.total_savings + savings.cache_savings)}`)}`
      );
      console.log("");

      console.log(`${COLORS.yellow}Time & ROI${COLORS.reset}`);
      console.log(`${COLORS.dim}──────────────────────────────────────────────${COLORS.reset}`);
      console.log(`  Time saved:           ${colorize("green", formatDuration(savings.time_saved_minutes))}`);
      console.log(`  Value (@ $${hourlyRate}/hr):  ${colorize("green", formatCurrency(savings.value_generated))}`);
      console.log(
        `  Net value:            ${colorize("green", formatCurrency(savings.value_generated - savings.actual_cost))}`
      );
      const roiDisplay = savings.roi_multiplier === Infinity ? "∞" : `${savings.roi_multiplier.toFixed(1)}x`;
      console.log(`  ROI:                  ${colorize("green", roiDisplay)} return`);
      console.log("");
    } else if (command === "csv") {
      const usageFile = getTokenUsageFile();
      const data = JSON.parse(await readFile(usageFile, "utf8")) as UsageData;
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - days);

      console.log("timestamp,script,model,prompt_tokens,completion_tokens,cached_tokens,total_tokens,cost_usd");
      data.sessions
        .filter((s) => new Date(s.timestamp) >= thresholdDate)
        .forEach((s) => {
          console.log(
            `${s.timestamp},${s.script},${s.model},${s.usage.prompt_tokens},${s.usage.completion_tokens},${s.usage.cached_tokens},${s.usage.total_tokens},${s.cost_usd}`
          );
        });
    } else if (command === "detailed") {
      const usageFile = getTokenUsageFile();
      const data = JSON.parse(await readFile(usageFile, "utf8")) as UsageData;
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - days);

      logger.header(`Detailed Report (Last ${days} days)`);

      data.sessions
        .filter((s) => new Date(s.timestamp) >= thresholdDate)
        .forEach((s) => {
          console.log(`${s.timestamp}`);
          console.log(`  Script: ${s.script}`);
          console.log(`  Model:  ${s.model}`);
          console.log(`  Tokens: ${s.usage.total_tokens} (P: ${s.usage.prompt_tokens}, C: ${s.usage.completion_tokens})`);
          console.log(`  Cached: ${s.usage.cached_tokens}`);
          console.log(`  Cost:   $${s.cost_usd}`);
          console.log("");
        });
    } else {
      logger.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  },
};

export default tokenCommand;
