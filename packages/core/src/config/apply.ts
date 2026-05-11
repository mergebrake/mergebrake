import type { Finding } from "mergebrake-shared";
import type { MergeBrakeConfig } from "./types.js";

/**
 * Apply config to a raw list of findings: drop ignored rules and globs, and
 * apply per-rule severity overrides. Returns a fresh array — the input is not
 * mutated. We do not collapse findings across rules; that's the verdict layer's
 * job.
 */
export function applyConfig(input: {
  findings: Finding[];
  config: MergeBrakeConfig;
}): Finding[] {
  const cfg = input.config;
  const globallyIgnored = new Set(cfg.ignore ?? []);
  const ignorePathMatchers = compileGlobs(cfg.ignorePaths ?? []);
  const overrides = (cfg.overrides ?? []).map((o) => ({
    matchers: compileGlobs(o.paths),
    ignore: new Set(o.ignore ?? []),
    severity: o.severity ?? {},
  }));

  const out: Finding[] = [];
  for (const f of input.findings) {
    if (globallyIgnored.has(f.ruleId)) continue;
    const file = f.location?.file ?? "";
    if (matchesAny(ignorePathMatchers, file)) continue;

    // Per-path overrides (applied in declaration order; first match wins).
    let droppedByOverride = false;
    let severity = f.severity;
    if (cfg.severity && cfg.severity[f.ruleId]) {
      severity = cfg.severity[f.ruleId]!;
    }
    for (const ov of overrides) {
      if (!matchesAny(ov.matchers, file)) continue;
      if (ov.ignore.has(f.ruleId)) {
        droppedByOverride = true;
        break;
      }
      if (ov.severity[f.ruleId]) {
        severity = ov.severity[f.ruleId]!;
      }
      // First matching override wins; stop walking the list.
      break;
    }
    if (droppedByOverride) continue;

    out.push({ ...f, severity });
  }
  return out;
}

type Matcher = (filePath: string) => boolean;

function compileGlobs(globs: string[]): Matcher[] {
  return globs.map((g) => {
    const normalized = g.replace(/\\/g, "/");
    const re = globToRegExp(normalized);
    return (filePath: string) => re.test(filePath.replace(/\\/g, "/"));
  });
}

function matchesAny(matchers: Matcher[], filePath: string): boolean {
  for (const m of matchers) {
    if (m(filePath)) return true;
  }
  return false;
}

/**
 * Tiny glob compiler. Supports `*`, `?`, `**` and `{a,b,c}` brace expansion.
 * Kept inline to avoid a dependency on minimatch.
 */
function globToRegExp(pattern: string): RegExp {
  const expanded = expandBraces(pattern);
  const parts = expanded.map(compileSingle);
  return new RegExp(`(?:${parts.join("|")})`);
}

function compileSingle(pattern: string): string {
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] ?? "";
    const next = pattern[i + 1] ?? "";
    if (ch === "*" && next === "*") {
      const after = pattern[i + 2] ?? "";
      if (after === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i++;
      }
      continue;
    }
    if (ch === "*") {
      source += "[^/]*";
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegex(ch);
  }
  source += "$";
  return source;
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match || match.index === undefined) return [pattern];
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  const parts = match[1]!.split(",").map((p) => p.trim());
  const out: string[] = [];
  for (const p of parts) {
    for (const tail of expandBraces(after)) {
      out.push(`${before}${p}${tail}`);
    }
  }
  return out;
}

function escapeRegex(ch: string): string {
  return ch.replace(/[|\\(){}[\]^$+.]/g, "\\$&");
}
