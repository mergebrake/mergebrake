import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import type { OrmStack } from "@mergebrake/shared";

export interface SqlBlock {
  sourceFile: string;
  ormStack: OrmStack;
  sql: string;
  /** Line offset of the first SQL line within sourceFile (1-based). */
  startLine: number;
}

export interface ExtractOptions {
  ormStack: OrmStack;
  inputs: string[];
  repoRoot: string;
}

export async function extractSqlFromOrm(
  opts: ExtractOptions,
): Promise<SqlBlock[]> {
  const resolvedInputs = await resolveInputs(opts.inputs, opts.repoRoot);
  const blocks: SqlBlock[] = [];

  for (const file of resolvedInputs) {
    const ext = path.extname(file).toLowerCase();
    const content = await fs.readFile(file, "utf-8");
    const sourceFile = toReportPath(opts.repoRoot, file);

    if (ext === ".sql") {
      blocks.push({
        sourceFile,
        ormStack: opts.ormStack === "raw-sql" ? "raw-sql" : opts.ormStack,
        sql: content,
        startLine: 1,
      });
      continue;
    }

    if (opts.ormStack === "knex" && (ext === ".ts" || ext === ".js")) {
      const extracted = extractKnexRawSql(content);
      if (extracted.length > 0) {
        for (const block of extracted) {
          blocks.push({
            sourceFile,
            ormStack: "knex",
            sql: block.sql,
            startLine: block.startLine,
          });
        }
      }
    }

    if (opts.ormStack === "typeorm" && ext === ".ts") {
      const extracted = extractTypeormRawSql(content);
      for (const block of extracted) {
        blocks.push({
          sourceFile,
          ormStack: "typeorm",
          sql: block.sql,
          startLine: block.startLine,
        });
      }
    }
  }

  return blocks;
}

async function resolveInputs(
  inputs: string[],
  cwd: string,
): Promise<string[]> {
  const files = new Set<string>();
  for (const input of inputs) {
    if (input.includes("*") || input.includes("?")) {
      const matches = await fg(input, { cwd, absolute: true, onlyFiles: true });
      for (const m of matches) files.add(m);
    } else {
      const abs = path.isAbsolute(input) ? input : path.join(cwd, input);
      try {
        const stat = await fs.stat(abs);
        if (stat.isDirectory()) {
          const matches = await fg("**/*.{sql,ts,js}", {
            cwd: abs,
            absolute: true,
            onlyFiles: true,
          });
          for (const m of matches) files.add(m);
        } else {
          files.add(abs);
        }
      } catch {
        // file missing — silently skip; caller can decide to error if 0 files
      }
    }
  }
  return Array.from(files);
}

function toReportPath(repoRoot: string, file: string): string {
  const relative = path.relative(repoRoot, file);
  const display =
    relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative
      : file;
  return display.replace(/\\/g, "/");
}

interface RawBlock {
  sql: string;
  startLine: number;
}

function extractKnexRawSql(content: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  // Match knex.raw('...') / knex.raw(`...`) with naive heuristic.
  const re = /knex\.raw\s*\(\s*([`'"])([\s\S]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const before = content.slice(0, match.index);
    const startLine = before.split("\n").length;
    blocks.push({ sql: match[2] ?? "", startLine });
  }
  return blocks;
}

function extractTypeormRawSql(content: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  // Match queryRunner.query(`...`)
  const re = /queryRunner\.query\s*\(\s*[`'"]([\s\S]*?)[`'"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const before = content.slice(0, match.index);
    const startLine = before.split("\n").length;
    blocks.push({ sql: match[1] ?? "", startLine });
  }
  return blocks;
}
