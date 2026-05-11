import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
} from "../../parsers/postgres-ast.js";
import { camelize, snakeize } from "../../recipes/symbol-variants.js";

/**
 * `ALTER COLUMN ... DROP DEFAULT` is cheap on the database side but changes
 * the contract for INSERT statements that previously omitted the column.
 * If any caller still issues an INSERT without the column and the column is
 * NOT NULL, the next request crashes.
 */
export const astDropDefault: AstRule = {
  id: "safety/drop-default",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_ColumnDefault") continue;
      // AT_ColumnDefault with `def === null` is a DROP DEFAULT (Postgres
      // represents both SET and DROP via this subtype). Some libpg_query
      // releases use AT_DropDefault explicitly; handle both.
      if (cmd.def !== undefined && cmd.def !== null) continue;
      const column = cmd.name ?? "";
      if (!column || !table) continue;
      findings.push(
        makeFinding(ctx, {
          ruleId: "safety/drop-default",
          severity: "low",
          title: `ALTER COLUMN ${table}.${column} DROP DEFAULT changes the INSERT contract`,
          message:
            `Dropping the default makes \`${column}\` a required argument on every INSERT that previously omitted it. ` +
            `If the column is still NOT NULL and any caller (app, background job, raw SQL) issues an INSERT without it, ` +
            `that INSERT now errors. Search MergeBrake's cross-references for INSERTs that rely on the default before merging.`,
          affectedSymbols: [
            column,
            camelize(column),
            snakeize(column),
            `${table}.${column}`,
          ],
          recipe: {
            summary: `Ship an app change that always sets the column on INSERT, then drop the default.`,
            steps: [
              {
                phase: "expand",
                description: `Update every INSERT path to set \`${column}\` explicitly. Verify with a code review pass.`,
                appCodeNote: `Search the cross-references for INSERT or .create() calls that omit the column.`,
              },
              {
                phase: "contract",
                description: `Drop the default after a release cycle.`,
                sql: `ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT;`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/safety/drop-default",
        }),
      );
    }

    // Some Postgres versions split the path into a dedicated AT_DropDefault.
    // We don't have explicit typings for it; the kind name string match keeps
    // the rule future-proof without depending on libpg_query enum stability.
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_DropDefault") continue;
      const column = cmd.name ?? "";
      if (!column || !table) continue;
      findings.push(
        makeFinding(ctx, {
          ruleId: "safety/drop-default",
          severity: "low",
          title: `ALTER COLUMN ${table}.${column} DROP DEFAULT changes the INSERT contract`,
          message: `Dropping the default makes \`${column}\` a required argument on every INSERT that previously omitted it.`,
          affectedSymbols: [column, `${table}.${column}`],
          docsUrl: "https://mergebrake.dev/rules/safety/drop-default",
        }),
      );
    }
    return findings;
  },
};
