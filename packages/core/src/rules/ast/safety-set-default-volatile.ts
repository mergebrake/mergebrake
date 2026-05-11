import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  VOLATILE_FUNC_NAMES,
  TABLE_REWRITE_DEFAULT_FUNC_NAMES,
  funcCallNameFromNode,
  type ColumnDef,
} from "../../parsers/postgres-ast.js";

/**
 * Function defaults are deploy-sensitive. `ADD COLUMN ... DEFAULT
 * gen_random_uuid()` can materialize every existing row, while `ALTER COLUMN ...
 * SET DEFAULT now()` only affects future inserts but still changes app-visible
 * behavior.
 */
export const astSetDefaultVolatile: AstRule = {
  id: "safety/set-default-volatile",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);

    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (!cmd) continue;

      if (cmd.subtype === "AT_ColumnDefault") {
        const match = volatileDefault(cmd.def);
        if (!match) continue;
        const column = cmd.name ?? "";
        findings.push(
          makeFinding(ctx, {
            ruleId: "safety/set-default-volatile",
            severity: "medium",
            title: `SET DEFAULT ${match.fnName}() on ${table}.${column} is non-literal`,
            message:
              `\`SET DEFAULT ${match.fnName}()\` changes the value assigned to future inserts for ` +
              `\`${table}.${column}\`. This does not rewrite existing rows by itself, but it is still ` +
              `deploy-sensitive: app code and tests may start observing generated timestamps/IDs ` +
              `immediately after this migration. Use a literal default when you need a constant fallback.`,
            affectedSymbols: [column, `${table}.${column}`],
            recipe: {
              summary: `Use a literal default, or make the generated value explicit in app code.`,
              steps: [
                {
                  phase: "expand",
                  description: `If the value should be constant, pin it instead of calling a function.`,
                  sql: `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT '<literal>';`,
                },
              ],
            },
            docsUrl: "https://mergebrake.dev/rules/safety/set-default-volatile",
          }),
        );
      }

      if (cmd.subtype === "AT_AddColumn") {
        const col = (cmd.def as { ColumnDef?: ColumnDef } | undefined)?.ColumnDef;
        if (!col?.colname) continue;

        for (const expr of columnDefaultExpressions(col)) {
          const match = volatileDefault(expr);
          if (!match) continue;
          findings.push(
            makeFinding(ctx, {
              ruleId: "safety/set-default-volatile",
              severity: match.rewritesTable ? "high" : "medium",
              title: `ADD COLUMN ${table}.${col.colname} DEFAULT ${match.fnName}() needs review`,
              message: match.rewritesTable
                ? `Adding \`${table}.${col.colname}\` with \`DEFAULT ${match.fnName}()\` can force Postgres to materialize a generated value for every existing row while holding an ACCESS EXCLUSIVE lock. Add the column without the function default, backfill in batches, then add the default for future inserts.`
                : `Adding \`${table}.${col.colname}\` with \`DEFAULT ${match.fnName}()\` assigns existing rows a migration-time generated value and changes future insert behavior. Add the column first, backfill intentionally, then set the default once app code is ready.`,
              affectedSymbols: [col.colname, `${table}.${col.colname}`],
              recipe: {
                summary: `Split the generated default into expand, batched backfill, and contract phases.`,
                steps: [
                  {
                    phase: "expand",
                    description: `Add the column without the generated default.`,
                    sql: `ALTER TABLE ${table} ADD COLUMN ${col.colname} <type>;`,
                  },
                  {
                    phase: "migrate-data",
                    description: `Backfill deliberately in small batches outside the main schema migration.`,
                    sql:
                      `UPDATE ${table}\n` +
                      `SET ${col.colname} = ${match.fnName}()\n` +
                      `WHERE ${col.colname} IS NULL\n` +
                      `  AND <batch predicate>;`,
                  },
                  {
                    phase: "contract",
                    description: `Only then add the default for future inserts.`,
                    sql: `ALTER TABLE ${table} ALTER COLUMN ${col.colname} SET DEFAULT ${match.fnName}();`,
                  },
                ],
              },
              docsUrl: "https://mergebrake.dev/rules/safety/set-default-volatile",
            }),
          );
        }
      }
    }

    return findings;
  },
};

function columnDefaultExpressions(col: ColumnDef): unknown[] {
  const exprs: unknown[] = [];
  if (col.raw_default !== undefined) exprs.push(col.raw_default);
  for (const c of col.constraints ?? []) {
    if (c.Constraint?.contype === "CONSTR_DEFAULT") {
      exprs.push(c.Constraint.raw_expr);
    }
  }
  return exprs;
}

function volatileDefault(
  expr: unknown,
): { fnName: string; rewritesTable: boolean } | null {
  const fnName = funcCallNameFromNode(expr).toLowerCase();
  if (!fnName) return null;
  const shortName = fnName.split(".").pop() ?? fnName;
  if (!VOLATILE_FUNC_NAMES.has(shortName)) return null;
  return {
    fnName,
    rewritesTable: TABLE_REWRITE_DEFAULT_FUNC_NAMES.has(shortName),
  };
}
