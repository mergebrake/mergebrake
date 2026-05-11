import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_FILE_NAMES, type MergeBrakeConfig } from "./types.js";
import { parseConfig } from "./parser.js";

export interface LoadConfigInput {
  /** Repository root to search when no explicit path is given. */
  repoRoot: string;
  /** Explicit path passed via `--config <path>`. */
  explicitPath?: string;
}

export interface LoadConfigResult {
  config: MergeBrakeConfig;
  /** Absolute path of the file that was loaded (`null` when no file found). */
  source: string | null;
  /** Non-fatal warnings (unknown keys, deprecated fields, etc.). */
  warnings: string[];
}

/**
 * Load `.mergebrake.yml` from disk and parse it. When `explicitPath` is set the
 * file is required to exist; otherwise we look for the first match among
 * `CONFIG_FILE_NAMES` in `repoRoot`. Missing files return an empty config —
 * MergeBrake is happy without one.
 */
export async function loadConfig(
  input: LoadConfigInput,
): Promise<LoadConfigResult> {
  if (input.explicitPath) {
    const absolute = path.resolve(input.explicitPath);
    let raw: string;
    try {
      raw = await fs.readFile(absolute, "utf-8");
    } catch (err) {
      throw new Error(
        `--config ${input.explicitPath}: cannot read file (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const parsed = parseConfig(raw);
    return { config: parsed.config, source: absolute, warnings: parsed.warnings };
  }

  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(input.repoRoot, name);
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      const parsed = parseConfig(raw);
      return {
        config: parsed.config,
        source: candidate,
        warnings: parsed.warnings,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }

  return { config: {}, source: null, warnings: [] };
}
