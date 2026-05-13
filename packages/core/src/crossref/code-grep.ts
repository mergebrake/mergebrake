import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import type { CrossRef } from "mergebrake-shared";

export interface FindCrossReferencesOptions {
  repoRoot: string;
  symbols: string[];
  /** Globs to scan. Defaults to repo-wide app-code paths excluding generated. */
  globs?: string[];
  /** Hard cap on matches per symbol to keep reports actionable. */
  maxMatchesPerSymbol?: number;
}

const DEFAULT_GLOBS = [
  "**/*.{ts,tsx,js,jsx,mts,cts,sql,py,go,java,kt,rb,php,cs,rs,scala,swift}",
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/out/**",
  "!**/.next/**",
  "!**/.nuxt/**",
  "!**/.svelte-kit/**",
  "!**/.turbo/**",
  "!**/.vercel/**",
  "!**/.cache/**",
  "!**/coverage/**",
  "!**/generated/**",
  "!**/__generated__/**",
  "!**/vendor/**",
  "!**/target/**",
  "!**/.git/**",
  "!**/prisma/migrations/**",
  "!**/drizzle/**/*.sql",
  "!**/drizzle/meta/**",
  "!**/migrations/**",
  "!**/db/migrate/**",
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
  const seenRefs = new Set<string>();
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
    const commentState = { inBlockComment: false };
    const searchableLines = lines.map((line) =>
      stripCommentsFromLine(line, commentState),
    );

    for (const symbol of opts.symbols) {
      const count = symbolCount.get(symbol) ?? 0;
      if (count >= maxPerSymbol) continue;

      const matcher = buildSymbolMatcher(symbol);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const searchableLine = searchableLines[i] ?? "";
        if (!searchableLine.trim()) continue;
        if (matcher.test(searchableLine)) {
          const key = `${file}:${i + 1}:${line.trim()}`;
          if (seenRefs.has(key)) continue;
          seenRefs.add(key);
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

function stripCommentsFromLine(
  line: string,
  state: { inBlockComment: boolean },
): string {
  let out = "";
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    const next = line[i + 1] ?? "";

    if (state.inBlockComment) {
      if (ch === "*" && next === "/") {
        state.inBlockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "*") {
      state.inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") return out;
    if (ch === "-" && next === "-") return out;
    if (ch === "#") return out;

    out += ch;
  }

  return out;
}

/**
 * Build a regex that matches the symbol as a "wordish" token in code.
 * We treat dotted access (e.g. `user.full_name`), bracket access (`['full_name']`),
 * and ORM-style references (`User.fullName`, `users.full_name`) as positive matches.
 */
function buildSymbolMatcher(symbol: string): RegExp {
  const parts = symbol.split(".");
  if (parts.length >= 2) {
    const table = parts.slice(0, -1).join(".");
    const column = parts[parts.length - 1] ?? "";
    const escapedTable = escapeRegex(table);
    const escapedColumn = escapeRegex(column);
    return new RegExp(
      `(?:\\b${escapeRegex(symbol)}\\b|['"\`]${escapeRegex(symbol)}['"\`]|["'\`]?${escapedTable}["'\`]?\\s*\\.\\s*["'\`]?${escapedColumn}["'\`]?)`,
    );
  }
  const escaped = escapeRegex(symbol);
  // Word boundary on both sides, or quoted (for ORM column references)
  return new RegExp(`(?:\\b${escaped}\\b|['"\`]${escaped}['"\`])`);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
