import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
} from "../../parsers/postgres-ast.js";
import { camelize, snakeize } from "../../recipes/symbol-variants.js";

/**
 * `ALTER COLUMN ... DROP NOT NULL` is a low-cost DDL — Postgres just updates
 * the catalog, no rewrite. The risk is asymmetric: every line of application
 * code that assumed the column was non-null can now hit a NullPointerException,
 * `cannot destructure of undefined`, or worse, write `null` to fields a caller
 * downstream still expects to be present.
 */
export const astDropNotNull: AstRule = {
  id: "safety/drop-not-null",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_DropNotNull") continue;
      const column = cmd.name ?? "";
      if (!column || !table) continue;
      findings.push(
        makeFinding(ctx, {
          ruleId: "safety/drop-not-null",
          severity: "medium",
          title: `ALTER COLUMN ${table}.${column} DROP NOT NULL relaxes an invariant`,
          message:
            `Dropping NOT NULL is a free operation in Postgres but a hard contract change for the app. ` +
            `Every read of \`${column}\` that previously relied on non-null semantics — ORM models, API serializers, ` +
            `validators, downstream consumers — now needs to handle \`null\`. Land the app-side null-tolerance first, ` +
            `then run the migration.`,
          affectedSymbols: [
            column,
            camelize(column),
            snakeize(column),
            `${table}.${column}`,
          ],
          recipe: {
            summary: `Ship null-tolerant app code first, then relax the column.`,
            steps: [
              {
                phase: "expand",
                description: `Update TypeScript / Python / Go types so \`${column}\` is optional. Update serializers and validators.`,
                appCodeNote: `Search MergeBrake's cross-references — every read of \`${column}\` is a candidate for a null guard.`,
              },
              {
                phase: "contract",
                description: `After one full release cycle on the null-tolerant code, run the DDL.`,
                sql: `ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL;`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/safety/drop-not-null",
        }),
      );
    }
    return findings;
  },
};
