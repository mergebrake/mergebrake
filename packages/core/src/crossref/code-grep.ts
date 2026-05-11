import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import type { CrossRef } from "@mergebrake/shared";

export interface FindCrossReferencesOptions {
  repoRoot: string;
  symbols: string[];
  /** Globs to scan. Defaults to common TS/JS/Python paths excluding generated. */
  globs?: string[];
  /** Hard cap on matches per symbol to keep reports actionable. */
  maxMatchesPerSymbol?: number;
}

const DEFAULT_GLOBS = [
  "src/**/*.{ts,tsx,js,jsx,mts,cts}",
  "app/**/*.{ts,tsx,js,jsx}",
  "lib/**/*.{ts,tsx,js,jsx}",
  "server/**/*.{ts,tsx,js,jsx}",
  "api/**/*.{ts,tsx,js,jsx}",
  "**/*.py",
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/.next/**",
  "!**/coverage/**",
  "!**/generated/**",
  "!**/.git/**",
];

export async function findCrossReferences(
  opts: FindCrossReferencesOptions,
): Promise<CrossRef[]> {
  const globs = opts.globs ?? DEFAULT_GLOBS;
  const maxPerSymbol = opts.maxMatchesPerSymbol ?? 8;

  const files = await fg(globs, {
    cwd: opts.repoRoot,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  });

  const refs: CrossRef[] = [];
  const symbolCount = new Map<string, number>();

  for (const symbol of opts.symbols) {
    symbolCount.set(symbol, 0);
  }

  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");

    for (const symbol of opts.symbols) {
      const count = symbolCount.get(symbol) ?? 0;
      if (count >= maxPerSymbol) continue;

      const matcher = buildSymbolMatcher(symbol);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (isCommentOnlyLine(line)) continue;
        if (matcher.test(line)) {
          refs.push({
            file: path.relative(opts.repoRoot, file).replace(/\\/g, "/"),
            line: i + 1,
            snippet: line.trim().slice(0, 200),
            symbol,
          });
          const next = (symbolCount.get(symbol) ?? 0) + 1;
          symbolCount.set(symbol, next);
          if (next >= maxPerSymbol) break;
        }
      }
    }
  }

  return refs;
}

function isCommentOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("--") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

/**
 * Build a regex that matches the symbol as a "wordish" token in code.
 * We treat dotted access (e.g. `user.full_name`), bracket access (`['full_name']`),
 * and ORM-style references (`User.fullName`, `users.full_name`) as positive matches.
 */
function buildSymbolMatcher(symbol: string): RegExp {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word boundary on both sides, or quoted (for ORM column references)
  return new RegExp(`(?:\\b${escaped}\\b|['"\`]${escaped}['"\`])`);
}
