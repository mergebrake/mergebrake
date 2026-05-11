import type { Finding } from "@mergebrake/shared";
import type { Rule, RuleContext } from "./index.js";
import { splitStatements, matchAddColumnNotNullNoDefault } from "./sql-util.js";

export const addNotNullWithoutDefaultRule: Rule = {
  id: "locking/add-not-null-without-default",
  scan(ctx: RuleContext): Finding[] {
    const stmts = splitStatements(ctx.block.sql);
    const findings: Finding[] = [];
    for (const s of stmts) {
      const matches = matchAddColumnNotNullNoDefault(s.text);
      for (const m of matches) {
        findings.push({
          ruleId: "locking/add-not-null-without-default",
          severity: "high",
          title: `ADD COLUMN ${m.column} NOT NULL without DEFAULT blocks writes on ${m.table}`,
          message:
            `Adding a NOT NULL column without a DEFAULT requires Postgres to rewrite every existing row, ` +
            `holding an ACCESS EXCLUSIVE lock on \`${m.table}\` for the duration. On large tables this means ` +
            `minutes (or hours) of downtime. Also, any INSERT issued during the migration that omits the new column will fail.`,
          location: {
            file: ctx.block.sourceFile,
            line: ctx.block.startLine + s.startLine - 1,
          },
          ormStack: ctx.ormStack,
          dialect: ctx.dialect,
          affectedSymbols: [m.column, `${m.table}.${m.column}`],
          crossRefs: [],
          recipe: {
            summary: `Add the column as nullable, backfill, then set NOT NULL with a separate validated constraint.`,
            steps: [
              {
                phase: "expand",
                description: `Add the column as NULL or with a non-volatile DEFAULT. In Postgres 11+, adding a column with a constant DEFAULT is fast (no rewrite).`,
                sql: `ALTER TABLE ${m.table} ADD COLUMN ${m.column} <type>;\n`,
              },
              {
                phase: "migrate-data",
                description: `Backfill values in batches to avoid long-running transactions. Then deploy app code that always sets the column on INSERT/UPDATE.`,
                sql:
                  `-- Example batched backfill\n` +
                  `UPDATE ${m.table} SET ${m.column} = <value>\n` +
                  `WHERE ${m.column} IS NULL AND id IN (SELECT id FROM ${m.table} WHERE ${m.column} IS NULL LIMIT 5000);`,
              },
              {
                phase: "contract",
                description: `Add a NOT VALID constraint first (cheap), then VALIDATE separately (online).`,
                sql:
                  `ALTER TABLE ${m.table} ADD CONSTRAINT ${m.table}_${m.column}_not_null CHECK (${m.column} IS NOT NULL) NOT VALID;\n` +
                  `ALTER TABLE ${m.table} VALIDATE CONSTRAINT ${m.table}_${m.column}_not_null;\n` +
                  `-- Optionally promote later: ALTER TABLE ${m.table} ALTER COLUMN ${m.column} SET NOT NULL;`,
              },
            ],
          },
          docsUrl:
            "https://mergebrake.dev/rules/locking/add-not-null-without-default",
        });
      }
    }
    return findings;
  },
};
