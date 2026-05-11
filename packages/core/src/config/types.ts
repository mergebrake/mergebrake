import type { Severity } from "@mergebrake/shared";

/**
 * Parsed shape of a `.mergebrake.yml` file. Every field is optional so the
 * config can be added incrementally to an existing repo.
 */
export interface MergeBrakeConfig {
  /** Bump when we introduce breaking schema changes. */
  version?: 1;
  /** Override the CLI default fail policy. CLI `--fail-on` still wins. */
  failOn?: "SAFE" | "EXPAND_CONTRACT" | "BLOCK";
  /** Globally disable rules by id. */
  ignore?: string[];
  /** Override severity for a specific rule id. */
  severity?: Record<string, Severity>;
  /** Drop findings whose location matches any of these glob(s). */
  ignorePaths?: string[];
  /** More granular rule disable / severity override scoped to specific paths. */
  overrides?: MergeBrakeOverride[];
  /** Override `scan-scope` default in the GitHub Action. */
  scanScope?: "changed" | "all";
  /** Cross-reference grep tuning. */
  crossRef?: {
    /** Replace the default cross-ref globs. */
    globs?: string[];
    /** Cap matches per symbol (default 8). */
    maxMatchesPerSymbol?: number;
  };
}

export interface MergeBrakeOverride {
  /** One or more globs the finding location must match for the override to apply. */
  paths: string[];
  /** Rule ids to disable inside the matched paths. */
  ignore?: string[];
  /** Per-rule severity override. */
  severity?: Record<string, Severity>;
}

export const CONFIG_FILE_NAMES = [
  ".mergebrake.yml",
  ".mergebrake.yaml",
  "mergebrake.config.yml",
  "mergebrake.config.yaml",
] as const;

export const SEVERITY_VALUES: ReadonlyArray<Severity> = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const FAIL_ON_VALUES = [
  "SAFE",
  "EXPAND_CONTRACT",
  "BLOCK",
] as const;
