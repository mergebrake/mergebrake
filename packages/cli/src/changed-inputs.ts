import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ResolveChangedInputsOptions {
  repoRoot: string;
  inputs: string[];
  ref: string;
}

export async function resolveChangedInputs(
  opts: ResolveChangedInputsOptions,
): Promise<string[]> {
  const changed = await gitChangedFiles(opts.repoRoot, opts.ref);
  return filterChangedInputs(changed, opts.inputs);
}

export function filterChangedInputs(
  changedPaths: string[],
  inputPatterns: string[],
): string[] {
  const matchers = inputPatterns.flatMap((input) =>
    buildMatchers(expandBraces(normalizePath(input))),
  );
  const out = new Set<string>();

  for (const changed of changedPaths) {
    const normalized = normalizePath(changed);
    if (matchers.some((matcher) => matcher(normalized))) {
      out.add(normalized);
    }
  }

  return Array.from(out);
}

async function gitChangedFiles(repoRoot: string, ref: string): Promise<string[]> {
  const args = ["-C", repoRoot, "diff", "--name-only", "--diff-filter=ACMR"];
  const ranges = [`${ref}...HEAD`, `${ref}..HEAD`];
  let lastError: unknown = null;

  for (const range of ranges) {
    try {
      const { stdout } = await execFileAsync("git", [...args, range], {
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to compute changed files against ${ref}`);
}

type Matcher = (changedPath: string) => boolean;

function buildMatchers(patterns: string[]): Matcher[] {
  return patterns.map((pattern) => {
    if (hasGlob(pattern)) {
      const re = globToRegExp(pattern);
      return (changedPath: string) => re.test(changedPath);
    }

    const clean = pattern.replace(/\/$/, "");
    return (changedPath: string) =>
      changedPath === clean || changedPath.startsWith(`${clean}/`);
  });
}

function globToRegExp(pattern: string): RegExp {
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
  return new RegExp(source);
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match || match.index === undefined) return [pattern];

  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  const parts = match[1]!.split(",").map((part) => part.trim());
  const expanded: string[] = [];

  for (const part of parts) {
    for (const tail of expandBraces(after)) {
      expanded.push(`${before}${part}${tail}`);
    }
  }

  return expanded;
}

function hasGlob(input: string): boolean {
  return /[*?{]/.test(input);
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function escapeRegex(input: string): string {
  return input.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
