import type { Finding } from "mergebrake-shared";
import type { Rule, RuleContext } from "./index.js";
import { splitStatements, matchRenameColumn } from "./sql-util.js";
import { camelize, snakeize } from "../recipes/symbol-variants.js";

export const renameColumnRule: Rule = {
  id: "destructive/rename-column",
  scan(ctx: RuleContext): Finding[] {
    const stmts = splitStatements(ctx.block.sql);
    const findings: Finding[] = [];
    for (const s of stmts) {
      const renames = matchRenameColumn(s.text);
      for (const r of renames) {
        const symbolVariants = [
          r.fromColumn,
          camelize(r.fromColumn),
          snakeize(r.fromColumn),
        ];
        findings.push({
          ruleId: "destructive/rename-column",
          severity: "high",
          title: `RENAME COLUMN ${r.table}.${r.fromColumn} -> ${r.toColumn} is unsafe in a single deploy`,
          message:
            `Renaming a column is atomic at the database level but not at the application level: ` +
            `between the moment the migration runs and the moment the new app code reaches every replica, ` +
            `requests that hit old replicas will reference \`${r.fromColumn}\` and fail. ` +
            `Use an expand/contract sequence to make the rename zero-downtime.`,
          location: {
            file: ctx.block.sourceFile,
            line: ctx.block.startLine + s.startLine - 1,
          },
          ormStack: ctx.ormStack,
          dialect: ctx.dialect,
          affectedSymbols: dedupe(symbolVariants),
          crossRefs: [],
          recipe: {
            summary:
              `Three-phase expand/contract: add the new column, dual-write, then drop the old column.`,
            steps: [
              {
                phase: "expand",
                description: `Add \`${r.toColumn}\` as a nullable column alongside \`${r.fromColumn}\`. Backfill values from the old column.`,
                sql:
                  `ALTER TABLE ${r.table} ADD COLUMN ${r.toColumn} <same_type>;\n` +
                  `UPDATE ${r.table} SET ${r.toColumn} = ${r.fromColumn};\n`,
              },
              {
                phase: "migrate-data",
                description: `Deploy app code that writes to both columns and reads from \`${r.toColumn}\` with a fallback to \`${r.fromColumn}\`. Wait for one full release cycle.`,
                appCodeNote: `Search MergeBrake's cross-references for every read/write of \`${r.fromColumn}\` and add a parallel reference to \`${r.toColumn}\`.`,
              },
              {
                phase: "contract",
                description: `Once all replicas are on the new code and \`${r.fromColumn}\` is no longer read, drop it.`,
                sql: `ALTER TABLE ${r.table} DROP COLUMN ${r.fromColumn};`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/destructive/rename-column",
        });
      }
    }
    return findings;
  },
};

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
