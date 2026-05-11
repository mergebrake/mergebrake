import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
} from "../../parsers/postgres-ast.js";
import { camelize, snakeize } from "../../recipes/symbol-variants.js";

/**
 * `ALTER COLUMN ... SET NOT NULL` scans every row in the table under
 * ACCESS EXCLUSIVE (until Postgres 12, after which there are some
 * optimisations when a matching CHECK constraint exists). The safe pattern is
 * to add a CHECK ... NOT VALID, VALIDATE it, then promote.
 */
export const astSetNotNull: AstRule = {
  id: "locking/set-not-null",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_SetNotNull") continue;
      const column = cmd.name ?? "";
      if (!column || !table) continue;
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/set-not-null",
          severity: "medium",
          title: `ALTER COLUMN ${table}.${column} SET NOT NULL scans the whole table`,
          message:
            `\`SET NOT NULL\` requires Postgres to verify every existing row is non-null under ACCESS EXCLUSIVE. ` +
            `On a large table that's minutes of blocked writes. Add a \`CHECK (col IS NOT NULL) NOT VALID\` ` +
            `constraint first, validate it online, then promote to NOT NULL.`,
          affectedSymbols: [
            column,
            camelize(column),
            snakeize(column),
            `${table}.${column}`,
          ],
          recipe: {
            summary: `Three-step promotion: NOT VALID CHECK → VALIDATE → SET NOT NULL.`,
            steps: [
              {
                phase: "expand",
                description: `Add a CHECK constraint NOT VALID (instant).`,
                sql: `ALTER TABLE ${table}\n  ADD CONSTRAINT ${table.replace(/\./g, "_")}_${column}_not_null\n  CHECK (${column} IS NOT NULL) NOT VALID;`,
              },
              {
                phase: "migrate-data",
                description: `Backfill any NULL rows, then validate the constraint online.`,
                sql: `ALTER TABLE ${table} VALIDATE CONSTRAINT ${table.replace(/\./g, "_")}_${column}_not_null;`,
              },
              {
                phase: "contract",
                description: `Postgres 12+ can promote to NOT NULL without rescanning. On older versions you can keep the CHECK constraint instead.`,
                sql: `ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/locking/set-not-null",
        }),
      );
    }
    return findings;
  },
};
