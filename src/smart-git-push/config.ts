import { getConfig } from "../utils/config.ts";

/**
 * Get the main/base branch from config
 */
export const getMainBranch = (): string => {
  return getConfig().git.baseBranch;
};

// Legacy export for backward compatibility
export const MAIN_BRANCH = "main";
