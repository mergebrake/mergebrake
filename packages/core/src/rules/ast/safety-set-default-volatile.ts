import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  funcCallName,
  VOLATILE_FUNC_NAMES,
  type FuncCall,
} from "../../parsers/postgres-ast.js";

/**
 * `ALTER COLUMN ... SET DEFAULT <volatile_function>` will be evaluated per-row
 * for any subsequent `ADD COLUMN` and may also force per-row evaluation on
 * existing rows for the migration if combined with a backfill. Even when not
 * paired with an immediate rewrite, it's a useful warning: many teams expect
 * `now()` to behave like a constant default and are surprised when historical
 * rows shift after the migration.
 */
export const astSetDefaultVolatile: AstRule = {
  id: "safety/set-default-volatile",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_ColumnDefault") continue;
      const fn = (cmd.def as { FuncCall?: FuncCall } | undefined)?.FuncCall;
      if (!fn) continue;
      const fnName = funcCallName(fn).toLowerCase();
      if (!fnName) continue;
      const shortName = fnName.split(".").pop() ?? fnName;
      if (!VOLATILE_FUNC_NAMES.has(shortName)) continue;
      const column = cmd.name ?? "";
      findings.push(
        makeFinding(ctx, {
          ruleId: "safety/set-default-volatile",
          severity: "medium",
          title: `SET DEFAULT ${fnName}() on ${table}.${column} is volatile`,
          message:
            `\`SET DEFAULT ${fnName}()\` is a volatile expression. ` +
            `Postgres re-evaluates it for every row that uses the default, including when you ` +
            `add a column with this default to an existing populated table — that triggers a ` +
            `full table rewrite under ACCESS EXCLUSIVE. If the goal is a constant fallback, ` +
            `pin it to a literal; if the goal is a per-row timestamp, use a BEFORE INSERT trigger ` +
            `or evaluate at the application layer.`,
          affectedSymbols: [column, `${table}.${column}`],
          recipe: {
            summary: `Use a constant default or move the volatile evaluation to a trigger.`,
            steps: [
              {
                phase: "expand",
                description: `If you need a constant fallback, pin it.`,
                sql: `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT '<literal>';`,
              },
              {
                phase: "migrate-data",
                description: `If you need a per-row timestamp on insert, attach a trigger so the migration itself doesn't rewrite rows.`,
                sql:
                  `CREATE OR REPLACE FUNCTION ${table.replace(/\./g, "_")}_${column}_set_now()\n` +
                  `RETURNS trigger AS $$ BEGIN NEW.${column} := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;\n` +
                  `\n` +
                  `CREATE TRIGGER ${table.replace(/\./g, "_")}_${column}_set_now\n` +
                  `  BEFORE INSERT ON ${table}\n` +
                  `  FOR EACH ROW EXECUTE FUNCTION ${table.replace(/\./g, "_")}_${column}_set_now();`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/safety/set-default-volatile",
        }),
      );
    }
    return findings;
  },
};
