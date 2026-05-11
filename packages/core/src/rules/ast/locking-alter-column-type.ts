import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  typeNameString,
  type ColumnDef,
} from "../../parsers/postgres-ast.js";
import { camelize, snakeize } from "../../recipes/symbol-variants.js";

/**
 * `ALTER TABLE ... ALTER COLUMN ... TYPE ...` is the classic table-rewrite trap.
 * For almost every type change Postgres has to rewrite every row, holding an
 * ACCESS EXCLUSIVE lock for the entire duration. On a 100M-row table that's
 * minutes of total downtime.
 */
export const astAlterColumnType: AstRule = {
  id: "locking/alter-column-type",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_AlterColumnType") continue;
      const column = cmd.name ?? "";
      if (!column || !table) continue;
      const def = (cmd.def as { ColumnDef?: ColumnDef } | undefined)?.ColumnDef;
      const newType = typeNameString(def?.typeName) || "<new_type>";
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/alter-column-type",
          severity: "high",
          title: `ALTER COLUMN ${table}.${column} TYPE ${newType} rewrites the whole table`,
          message:
            `Changing a column's type forces Postgres to rewrite every row of \`${table}\` ` +
            `under an ACCESS EXCLUSIVE lock. Reads, writes, and DDL on the table all block for the entire rewrite — ` +
            `on a multi-million-row table that's minutes of downtime, not seconds. ` +
            `The safe path is to add a new column of the target type, dual-write/backfill, then swap.`,
          affectedSymbols: [
            column,
            camelize(column),
            snakeize(column),
            `${table}.${column}`,
          ],
          recipe: {
            summary: `Add a new column, backfill, dual-write, swap, drop the old one.`,
            steps: [
              {
                phase: "expand",
                description: `Add the target column nullable. No lock contention.`,
                sql: `ALTER TABLE ${table} ADD COLUMN ${column}_new ${newType};\n`,
              },
              {
                phase: "migrate-data",
                description: `Backfill in batches and dual-write from the app while the column is being filled.`,
                sql:
                  `-- Batched backfill\n` +
                  `UPDATE ${table} SET ${column}_new = CAST(${column} AS ${newType})\n` +
                  `WHERE ${column}_new IS NULL\n` +
                  `  AND id IN (SELECT id FROM ${table} WHERE ${column}_new IS NULL LIMIT 5000);`,
                appCodeNote: `Update app code to write to both \`${column}\` and \`${column}_new\` and read from the new column with a fallback.`,
              },
              {
                phase: "contract",
                description: `Swap names atomically (after one full release on the dual-write code).`,
                sql:
                  `BEGIN;\n` +
                  `  ALTER TABLE ${table} RENAME COLUMN ${column} TO ${column}_old;\n` +
                  `  ALTER TABLE ${table} RENAME COLUMN ${column}_new TO ${column};\n` +
                  `COMMIT;\n` +
                  `-- Later, after another release that no longer references ${column}_old:\n` +
                  `ALTER TABLE ${table} DROP COLUMN ${column}_old;`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/locking/alter-column-type",
        }),
      );
    }
    return findings;
  },
};
