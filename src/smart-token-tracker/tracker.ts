import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { logger } from "../utils/common.ts";
import { getTokenUsageFile, isTrackingEnabled } from "./config.ts";
import type { Session, UsageData, UsageStats } from "./types.ts";

export const initTokenTracking = async (usageFile = getTokenUsageFile()) => {
  if (!existsSync(usageFile)) {
    await mkdir(dirname(usageFile), { recursive: true });
    await writeFile(usageFile, JSON.stringify({ version: "1.0", sessions: [] }, null, 2));
  }
};

export const trackTokenUsage = async (
  scriptName: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number,
  model: string = "unknown"
) => {
  if (!isTrackingEnabled()) return;

  const usageFile = getTokenUsageFile();
  await initTokenTracking(usageFile);

  const totalTokens = promptTokens + completionTokens;
  const effectiveTokens = Math.max(0, totalTokens - cachedTokens);

  // Cost calculation (Claude 3.5 Haiku pricing approximation)
  // Input: $0.25 / 1M
  // Output: $1.25 / 1M
  const costPrompt = (promptTokens * 0.25) / 1_000_000;
  const costCompletion = (completionTokens * 1.25) / 1_000_000;
  const totalCost = costPrompt + costCompletion;

  const session: Session = {
    script: scriptName,
    timestamp: new Date().toISOString(),
    model,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cached_tokens: cachedTokens,
      total_tokens: totalTokens,
      effective_tokens: effectiveTokens,
    },
    cost_usd: totalCost.toFixed(6),
  };

  try {
    const data: UsageData = JSON.parse(await readFile(usageFile, "utf8"));
    data.sessions.push(session);
    await writeFile(usageFile, JSON.stringify(data, null, 2));

    if (process.env.VERBOSE_TRACKING === "true") {
      logger.info(`📊 Token usage tracked to ${usageFile}`);
    }
  } catch (e) {
    logger.warn(`Failed to track token usage: ${e}`);
  }
};

export const trackFromResponse = async (scriptName: string, response: any, model: string = "unknown") => {
  if (!isTrackingEnabled()) return;
  if (!response?.usage) return;

  const usage = response.usage;
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  // Support both OpenRouter and Anthropic formats
  const cachedTokens = usage.cache_discount || usage.cache_read_input_tokens || 0;

  const finalCached = Math.max(0, cachedTokens); // Ensure non-negative

  await trackTokenUsage(scriptName, promptTokens, completionTokens, finalCached, model);
};

export const getUsageStats = async (days = 30): Promise<UsageStats | null> => {
  const usageFile = getTokenUsageFile();
  if (!existsSync(usageFile)) return null;

  try {
    const data: UsageData = JSON.parse(await readFile(usageFile, "utf8"));

    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - days);

    const sessions = data.sessions.filter((s) => new Date(s.timestamp) >= thresholdDate);

    const stats: UsageStats = {
      total_sessions: sessions.length,
      total_tokens: 0,
      effective_tokens: 0,
      cached_tokens: 0,
      total_cost: 0,
      by_script: [],
    };

    const scriptMap = new Map<
      string,
      { sessions: number; total_tokens: number; cached_tokens: number; cost: number }
    >();

    for (const s of sessions) {
      stats.total_tokens += s.usage.total_tokens;
      stats.effective_tokens += s.usage.effective_tokens;
      stats.cached_tokens += s.usage.cached_tokens;
      stats.total_cost += parseFloat(s.cost_usd);

      const scriptStats = scriptMap.get(s.script) || { sessions: 0, total_tokens: 0, cached_tokens: 0, cost: 0 };
      scriptStats.sessions++;
      scriptStats.total_tokens += s.usage.total_tokens;
      scriptStats.cached_tokens += s.usage.cached_tokens;
      scriptStats.cost += parseFloat(s.cost_usd);
      scriptMap.set(s.script, scriptStats);
    }

    stats.by_script = Array.from(scriptMap.entries()).map(([script, s]) => ({
      script,
      ...s,
    }));

    return stats;
  } catch (e) {
    logger.error(`Failed to read usage stats: ${e}`);
    return null;
  }
};

export const getSessions = async (days = 30): Promise<Session[]> => {
  const usageFile = getTokenUsageFile();
  if (!existsSync(usageFile)) return [];

  try {
    const data: UsageData = JSON.parse(await readFile(usageFile, "utf8"));

    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - days);

    return data.sessions.filter((s) => new Date(s.timestamp) >= thresholdDate);
  } catch (e) {
    logger.error(`Failed to read sessions: ${e}`);
    return [];
  }
};

export const clearData = async () => {
  const usageFile = getTokenUsageFile();
  if (!existsSync(usageFile)) {
    logger.warn("No usage data to clear");
    return;
  }

  const backupFile = `${usageFile}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await rename(usageFile, backupFile);
  logger.warn(`Backed up to: ${backupFile}`);

  await initTokenTracking(usageFile);
  logger.success("Usage data cleared");
};
