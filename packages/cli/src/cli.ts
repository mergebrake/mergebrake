#!/usr/bin/env node
import { Command } from "commander";
import { analyzeMigration, loadConfig } from "@mergebrake/core";
import type { AnalysisReport } from "@mergebrake/shared";
import { renderMarkdown, renderTerminal, renderJson } from "./renderers.js";
import { renderSarif } from "./sarif.js";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  postStickyComment,
  resolvePrNumber,
  DEFAULT_STICKY_MARKER,
} from "./github-comment.js";
import { resolveChangedInputs } from "./changed-inputs.js";

const program = new Command();

program
  .name("mergebrake")
  .description(
    "Catch database-breaking PRs before merge by mapping schema changes to impacted app code.",
  )
  .version("0.0.1");

program
  .command("scan", { isDefault: true })
  .description("Scan migration files and report risky changes")
  .argument(
    "<inputs...>",
    "Migration files, directories, or globs (e.g. prisma/migrations/**/migration.sql)",
  )
  .option("-r, --repo <path>", "Repository root for cross-surface analysis", process.cwd())
  .option(
    "--base-repo <path>",
    "Optional base-branch checkout for deploy-order impact checks",
  )
  .option(
    "-f, --format <format>",
    "Output format: terminal, markdown, json, github, sarif",
    "terminal",
  )
  .option("--orm <stack>", "Force ORM stack: prisma|drizzle|knex|sequelize|typeorm|raw-sql")
  .option("--dialect <dialect>", "Force DB dialect: postgres|mysql|sqlite", "postgres")
  .option("--commits <file>", "Path to a file with commit messages (one per line) for AI-PR detection")
  .option(
    "--changed-since <ref>",
    "Only scan input files changed since a git ref (e.g. origin/main).",
  )
  .option("--skip-cross-ref", "Skip cross-surface code grep (faster, less useful)")
  .option(
    "--config <path>",
    "Path to a .mergebrake.yml file. Defaults to auto-discovery from --repo.",
  )
  .option("--no-config", "Disable .mergebrake.yml auto-discovery.")
  .option("--fail-on <verdict>", "Exit non-zero when verdict matches: BLOCK|EXPAND_CONTRACT|SAFE")
  .action(async (inputs: string[], options) => {
    const commitMessages = options.commits
      ? (await readFile(path.resolve(options.commits), "utf-8"))
          .split(/^---$/m)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const repoRoot = path.resolve(options.repo);
    const scanInputs = options.changedSince
      ? await resolveChangedInputs({
          repoRoot,
          inputs,
          ref: String(options.changedSince),
        })
      : inputs;

    // Load .mergebrake.yml unless explicitly disabled.
    let loadedConfig: Awaited<ReturnType<typeof loadConfig>> = {
      config: {},
      source: null,
      warnings: [],
    };
    if (options.config !== false) {
      const explicit =
        typeof options.config === "string" ? options.config : undefined;
      const opts: Parameters<typeof loadConfig>[0] = { repoRoot };
      if (explicit) opts.explicitPath = explicit;
      loadedConfig = await loadConfig(opts);
      if (loadedConfig.source) {
        // eslint-disable-next-line no-console
        console.error(
          `mergebrake: loaded config from ${path.relative(repoRoot, loadedConfig.source) || loadedConfig.source}`,
        );
      }
      for (const w of loadedConfig.warnings) {
        // eslint-disable-next-line no-console
        console.error(`mergebrake: config warning: ${w}`);
      }
    }

    const analysisOptions = {
      repoRoot,
      inputs: scanInputs,
      commitMessages,
      ormStack: options.orm,
      dialect: options.dialect,
      skipCrossRef: options.skipCrossRef === true,
      config: loadedConfig.config,
    };
    if (options.baseRepo) {
      Object.assign(analysisOptions, {
        baseRepoRoot: path.resolve(options.baseRepo),
      });
    }

    const report = await analyzeMigration(analysisOptions);

    switch (options.format) {
      case "json":
        process.stdout.write(renderJson(report));
        break;
      case "markdown":
        process.stdout.write(renderMarkdown(report));
        break;
      case "github":
        process.stdout.write(renderMarkdown(report, { githubAnnotations: true }));
        break;
      case "sarif":
        process.stdout.write(renderSarif(report));
        break;
      case "terminal":
      default:
        process.stdout.write(renderTerminal(report));
        break;
    }

    // Precedence: CLI > config > default "BLOCK".
    const failOnRaw: string =
      typeof options.failOn === "string" && options.failOn.length > 0
        ? options.failOn
        : (loadedConfig.config.failOn ?? "BLOCK");
    const failOn = failOnRaw.toUpperCase();
    if (failOn === "BLOCK" && report.verdict === "BLOCK") process.exit(1);
    if (failOn === "EXPAND_CONTRACT" && report.verdict !== "SAFE") process.exit(1);
    if (failOn === "SAFE") {
      // Strict mode: any finding fails
      if (report.findings.length > 0) process.exit(1);
    }
  });

program
  .command("comment")
  .description(
    "Post or update a sticky MergeBrake comment on a pull request. " +
      "Reads a JSON report from stdin (or --from-file) and reposts the latest verdict.",
  )
  .option("--from-file <path>", "Path to a JSON report (output of `mergebrake scan --format json`).")
  .option("--from-stdin", "Read the JSON report from standard input.")
  .option("--token <token>", "GitHub token. Defaults to $GITHUB_TOKEN.")
  .option("--repo <owner/repo>", "Target repository slug. Defaults to $GITHUB_REPOSITORY.")
  .option("--pr <number>", "Pull request number. Defaults to the GitHub Actions event payload.")
  .option(
    "--marker <id>",
    "Hidden marker used to find this comment on subsequent runs.",
    DEFAULT_STICKY_MARKER,
  )
  .option("--api-base <url>", "GitHub API base URL (for GitHub Enterprise).")
  .option(
    "--skip-when-safe",
    "Do not post a comment when the verdict is SAFE with zero findings (useful for noisy repos).",
  )
  .option("--github-output", "Write comment metadata to $GITHUB_OUTPUT.")
  .option("--dry-run", "Print the body that would be posted and exit.")
  .action(async (options) => {
    const report = await loadReport({
      fromFile: options.fromFile,
      fromStdin: options.fromStdin === true,
    });

    if (
      options.skipWhenSafe &&
      report.verdict === "SAFE" &&
      report.findings.length === 0
    ) {
      // eslint-disable-next-line no-console
      console.error("mergebrake comment: verdict SAFE, skip-when-safe set, nothing to post.");
      if (options.githubOutput) {
        await writeGithubOutput({ action: "skipped" });
      }
      return;
    }

    if (options.dryRun) {
      process.stdout.write(renderMarkdown(report));
      return;
    }

    const token: string | undefined = options.token ?? process.env["GITHUB_TOKEN"];
    if (!token) {
      // eslint-disable-next-line no-console
      console.error(
        "mergebrake comment: missing GitHub token. Pass --token or set GITHUB_TOKEN.",
      );
      process.exit(2);
    }

    const repo: string | undefined =
      options.repo ?? process.env["GITHUB_REPOSITORY"];
    if (!repo) {
      // eslint-disable-next-line no-console
      console.error(
        "mergebrake comment: missing repository slug. Pass --repo or set GITHUB_REPOSITORY.",
      );
      process.exit(2);
    }

    const resolveOpts: Parameters<typeof resolvePrNumber>[0] = {
      readFile: (p) => readFile(p, "utf-8"),
    };
    if (options.pr !== undefined) resolveOpts.explicit = options.pr;
    const eventPath = process.env["GITHUB_EVENT_PATH"];
    if (eventPath) resolveOpts.eventPath = eventPath;
    const ref = process.env["GITHUB_REF"];
    if (ref) resolveOpts.ref = ref;
    const prNumber = await resolvePrNumber(resolveOpts);
    if (!prNumber) {
      // eslint-disable-next-line no-console
      console.error(
        "mergebrake comment: could not determine PR number. Pass --pr or run inside a pull_request workflow.",
      );
      process.exit(2);
    }

    const result = await postStickyComment({
      report,
      token: token as string,
      repo: repo as string,
      prNumber,
      marker: options.marker,
      apiBase: options.apiBase,
    });

    if (options.githubOutput) {
      await writeGithubOutput({
        action: result.action,
        "comment-id": result.commentId,
        "comment-url": result.htmlUrl,
      });
    }

    // eslint-disable-next-line no-console
    console.error(
      `mergebrake comment: ${result.action} comment` +
        (result.htmlUrl ? ` -> ${result.htmlUrl}` : "") +
        (result.commentId ? ` (id=${result.commentId})` : ""),
    );
  });

async function loadReport(opts: {
  fromFile?: string;
  fromStdin?: boolean;
}): Promise<AnalysisReport> {
  if (opts.fromFile) {
    const raw = await readFile(path.resolve(opts.fromFile), "utf-8");
    return parseReportJson(raw);
  }
  if (opts.fromStdin) {
    const raw = await readStdin();
    return parseReportJson(raw);
  }
  throw new Error(
    "mergebrake comment: provide --from-file <path> or --from-stdin to load the report.",
  );
}

function parseReportJson(raw: string): AnalysisReport {
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(withoutBom) as AnalysisReport;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf-8")),
    );
    process.stdin.on("error", reject);
  });
}

async function writeGithubOutput(
  values: Record<string, string | number | undefined>,
): Promise<void> {
  const outputPath = process.env["GITHUB_OUTPUT"];
  if (!outputPath) return;
  const lines = Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  if (lines.length === 0) return;
  await appendFile(outputPath, `${lines.join("\n")}\n`, "utf-8");
}

program.parseAsync().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("mergebrake: fatal error");
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(2);
});
