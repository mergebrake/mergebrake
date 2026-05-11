import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  funcCallNameFromNode,
  TABLE_REWRITE_DEFAULT_FUNC_NAMES,
  type ColumnDef,
} from "../../parsers/postgres-ast.js";

/**
 * `ADD COLUMN ... DEFAULT <non-fast-default>` is the actually dangerous
 * generated-default pattern. Postgres >= 11 fast-paths constant/stable
 * defaults, but functions such as gen_random_uuid(), random() and nextval()
 * must be materialized for existing rows. That means a full table rewrite
 * under ACCESS EXCLUSIVE and a large WAL spike on big tables.
 *
 * The sibling rule `safety/set-default-volatile` owns non-rewrite behaviour
 * changes such as ALTER COLUMN ... SET DEFAULT now().
 */
export const astAddColumnVolatileDefault: AstRule = {
  id: "locking/add-column-with-volatile-default",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_AddColumn") continue;
      const def = (cmd.def as { ColumnDef?: ColumnDef } | undefined)?.ColumnDef;
      if (!def?.colname) continue;
      const fnName = findRewriteDefault(def);
      if (!fnName) continue;
      const column = def.colname;
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/add-column-with-volatile-default",
          severity: "high",
          title: `ADD COLUMN ${table}.${column} DEFAULT ${fnName}() rewrites the table`,
          message:
            `\`${fnName}()\` cannot use Postgres' fast-default path. Adding \`${column}\` with this default forces Postgres to ` +
            `materialize a value for every existing row, requiring a full table rewrite under ACCESS EXCLUSIVE. ` +
            `On a sizeable \`${table}\` this can lock writes for minutes and create a large WAL spike. Add the column nullable, ` +
            `backfill in batches, then declare the default for future inserts.`,
          affectedSymbols: [column, `${table}.${column}`],
          recipe: {
            summary: `Avoid the rewrite by adding the column nullable, backfilling in batches, then setting the default.`,
            steps: [
              {
                phase: "expand",
                description: `Add the column without a default (no rewrite).`,
                sql: `ALTER TABLE ${table} ADD COLUMN ${column} <type>;`,
              },
              {
                phase: "migrate-data",
                description: `Backfill in batches outside the migration transaction.`,
                sql:
                  `-- Example batched backfill\n` +
                  `WITH batch AS (\n` +
                  `  SELECT ctid FROM ${table}\n` +
                  `  WHERE ${column} IS NULL\n` +
                  `  LIMIT 5000\n` +
                  `)\n` +
                  `UPDATE ${table} AS target\n` +
                  `SET ${column} = ${fnName}()\n` +
                  `FROM batch\n` +
                  `WHERE target.ctid = batch.ctid;`,
              },
              {
                phase: "contract",
                description: `Set the default for future inserts (no rewrite; affects new rows only).`,
                sql: `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${fnName}();`,
              },
            ],
          },
          docsUrl:
            "https://mergebrake.dev/rules/locking/add-column-with-volatile-default",
        }),
      );
    }
    return findings;
  },
};

function findRewriteDefault(col: ColumnDef): string | null {
  const exprs: unknown[] = [];
  if (col.raw_default !== undefined) exprs.push(col.raw_default);
  for (const c of col.constraints ?? []) {
    if (c.Constraint?.contype === "CONSTR_DEFAULT") {
      exprs.push(c.Constraint.raw_expr);
    }
  }

  for (const expr of exprs) {
    const fnName = funcCallNameFromNode(expr).toLowerCase();
    const shortName = fnName.split(".").pop() ?? fnName;
    if (TABLE_REWRITE_DEFAULT_FUNC_NAMES.has(shortName)) return fnName;
  }

  return null;
}
