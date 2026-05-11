#!/usr/bin/env node
import { Command } from "commander";
import { analyzeMigration } from "@mergebrake/core";
import { renderMarkdown, renderTerminal, renderJson } from "./renderers.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const program = new Command();

program
  .name("mergebrake")
  .description(
    "Hit the brake before AI-generated PRs hit production. Pre-merge guard for database migrations.",
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
    "-f, --format <format>",
    "Output format: terminal, markdown, json, github",
    "terminal",
  )
  .option("--orm <stack>", "Force ORM stack: prisma|drizzle|knex|sequelize|typeorm|raw-sql")
  .option("--dialect <dialect>", "Force DB dialect: postgres|mysql|sqlite", "postgres")
  .option("--commits <file>", "Path to a file with commit messages (one per line) for AI-PR detection")
  .option("--skip-cross-ref", "Skip cross-surface code grep (faster, less useful)")
  .option("--fail-on <verdict>", "Exit non-zero when verdict matches: BLOCK|EXPAND_CONTRACT|SAFE", "BLOCK")
  .action(async (inputs: string[], options) => {
    const commitMessages = options.commits
      ? (await readFile(path.resolve(options.commits), "utf-8"))
          .split(/^---$/m)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const report = await analyzeMigration({
      repoRoot: path.resolve(options.repo),
      inputs,
      commitMessages,
      ormStack: options.orm,
      dialect: options.dialect,
      skipCrossRef: options.skipCrossRef === true,
    });

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
      case "terminal":
      default:
        process.stdout.write(renderTerminal(report));
        break;
    }

    const failOn = String(options.failOn).toUpperCase();
    if (failOn === "BLOCK" && report.verdict === "BLOCK") process.exit(1);
    if (failOn === "EXPAND_CONTRACT" && report.verdict !== "SAFE") process.exit(1);
    if (failOn === "SAFE") {
      // Strict mode: any finding fails
      if (report.findings.length > 0) process.exit(1);
    }
  });

program.parseAsync().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("mergebrake: fatal error");
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(2);
});
