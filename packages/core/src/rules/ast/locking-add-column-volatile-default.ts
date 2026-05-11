import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  funcCallName,
  VOLATILE_FUNC_NAMES,
  type ColumnDef,
  type FuncCall,
} from "../../parsers/postgres-ast.js";

/**
 * `ADD COLUMN ... DEFAULT <volatile>` is the actually-dangerous default
 * pattern. Postgres >= 11 fast-paths `ADD COLUMN DEFAULT <constant>` without a
 * rewrite, but a volatile expression — `now()`, `gen_random_uuid()`,
 * `nextval(...)` — forces Postgres to evaluate the default per existing row,
 * which means a full table rewrite under ACCESS EXCLUSIVE. On a multi-million
 * row table that's tens of minutes of locked traffic and a giant WAL spike.
 *
 * (The sibling rule `safety/set-default-volatile` only warns about behaviour
 * changes on future inserts — see that rule for the ALTER COLUMN ... SET
 * DEFAULT path.)
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
      const fn = findVolatileDefault(def);
      if (!fn) continue;
      const fnName = funcCallName(fn).toLowerCase();
      const column = def.colname;
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/add-column-with-volatile-default",
          severity: "high",
          title: `ADD COLUMN ${table}.${column} DEFAULT ${fnName}() rewrites the table`,
          message:
            `\`${fnName}()\` is a volatile expression. Adding a column with a volatile default forces Postgres to ` +
            `evaluate the default for every existing row, requiring a full table rewrite under ACCESS EXCLUSIVE. ` +
            `On a sizeable \`${table}\` this is tens of minutes of locked writes. Add the column nullable, backfill ` +
            `in batches, then declare the default (or wire a BEFORE INSERT trigger if every row needs a per-insert value).`,
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
                  `UPDATE ${table} SET ${column} = ${fnName}()\n` +
                  `WHERE ${column} IS NULL\n` +
                  `  AND id IN (SELECT id FROM ${table} WHERE ${column} IS NULL LIMIT 5000);`,
              },
              {
                phase: "contract",
                description: `Set the default for future inserts (no rewrite — affects new rows only).`,
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

function findVolatileDefault(col: ColumnDef): FuncCall | null {
  for (const c of col.constraints ?? []) {
    if (c.Constraint?.contype !== "CONSTR_DEFAULT") continue;
    const expr = (c.Constraint as { raw_expr?: unknown }).raw_expr;
    const fn = extractFuncCall(expr);
    if (!fn) continue;
    const name = funcCallName(fn).split(".").pop() ?? "";
    if (VOLATILE_FUNC_NAMES.has(name.toLowerCase())) return fn;
  }
  return null;
}

function extractFuncCall(expr: unknown): FuncCall | null {
  if (!expr || typeof expr !== "object") return null;
  const o = expr as Record<string, unknown>;
  if ("FuncCall" in o && o.FuncCall) return o.FuncCall as FuncCall;
  // Cast wrappers (e.g. now()::timestamptz) hide the function under TypeCast.arg
  if ("TypeCast" in o && o.TypeCast && typeof o.TypeCast === "object") {
    const arg = (o.TypeCast as { arg?: unknown }).arg;
    return extractFuncCall(arg);
  }
  return null;
}
