/**
 * sg CLI configuration
 * https://github.com/falconiere/smart-scripts
 */
import type { SgConfig } from "smart-scripts";

export default {
  git: {
    baseBranch: "main",
    forceWithLease: true,
  },
  ai: {
    model: "anthropic/claude-haiku-4.5",
    cacheEnabled: true,
  },
  output: {
    colors: true,
  },
} satisfies Partial<SgConfig>;
