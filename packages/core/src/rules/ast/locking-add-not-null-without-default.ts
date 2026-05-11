import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  columnInlineConstraints,
  type ColumnDef,
} from "../../parsers/postgres-ast.js";

export const astAddNotNullWithoutDefault: AstRule = {
  id: "locking/add-not-null-without-default",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_AddColumn") continue;
      const def = (cmd.def as { ColumnDef?: ColumnDef } | undefined)?.ColumnDef;
      if (!def?.colname) continue;
      const constraints = columnInlineConstraints(def);
      if (!constraints.has("CONSTR_NOTNULL")) continue;
      if (constraints.has("CONSTR_DEFAULT")) continue;
      const column = def.colname;
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/add-not-null-without-default",
          severity: "high",
          title: `ADD COLUMN ${column} NOT NULL without DEFAULT is unsafe on ${table}`,
          message:
            `Adding a NOT NULL column without a DEFAULT is not a safe single-step migration. ` +
            `On a non-empty Postgres table it usually fails because existing rows would contain NULL; ` +
            `even when it succeeds, the DDL takes an ACCESS EXCLUSIVE lock on \`${table}\`, and any INSERT ` +
            `that omits the new column will fail as soon as the migration lands.`,
          affectedSymbols: [column, `${table}.${column}`],
          recipe: {
            summary: `Add the column as nullable, backfill, then set NOT NULL with a separate validated constraint.`,
            steps: [
              {
                phase: "expand",
                description: `Add the column as NULL or with a non-volatile DEFAULT. In Postgres 11+, adding a column with a constant DEFAULT is fast (no rewrite).`,
                sql: `ALTER TABLE ${table} ADD COLUMN ${column} <type>;\n`,
              },
              {
                phase: "migrate-data",
                description: `Backfill values in batches to avoid long-running transactions. Then deploy app code that always sets the column on INSERT/UPDATE.`,
                sql:
                  `-- Example batched backfill\n` +
                  `UPDATE ${table} SET ${column} = <value>\n` +
                  `WHERE ${column} IS NULL AND id IN (SELECT id FROM ${table} WHERE ${column} IS NULL LIMIT 5000);`,
              },
              {
                phase: "contract",
                description: `Add a NOT VALID constraint first (cheap), then VALIDATE separately (online).`,
                sql:
                  `ALTER TABLE ${table} ADD CONSTRAINT ${table.replace(/\./g, "_")}_${column}_not_null CHECK (${column} IS NOT NULL) NOT VALID;\n` +
                  `ALTER TABLE ${table} VALIDATE CONSTRAINT ${table.replace(/\./g, "_")}_${column}_not_null;\n` +
                  `-- Optionally promote later: ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`,
              },
            ],
          },
          docsUrl:
            "https://mergebrake.dev/rules/locking/add-not-null-without-default",
        }),
      );
    }
    return findings;
  },
};
