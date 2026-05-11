import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import { isAlterEnumStmt } from "../../parsers/postgres-ast.js";

/**
 * Two distinct AlterEnumStmt patterns are flagged:
 *
 * 1. ADD VALUE — must not run inside a transaction in older Postgres versions
 *    (committed before any subsequent statement that depends on the new value).
 *    Even in modern versions, mixing ADD VALUE with usage in the same migration
 *    transaction is fragile.
 * 2. RENAME VALUE — applications often hardcode enum values as string literals
 *    (`if status === 'archived'`). Renaming silently breaks every such call
 *    site, just like renaming a column does.
 */
export const astAlterEnum: AstRule = {
  id: "safety/alter-enum-value",
  scan(ctx) {
    if (!isAlterEnumStmt(ctx.statement)) return [];
    const node = ctx.statement.node;
    const enumName = (node.typeName ?? [])
      .map((t) => t.String?.sval ?? "")
      .filter(Boolean)
      .join(".");
    if (!enumName) return [];

    const isRename = Boolean(node.oldVal);

    if (isRename) {
      const oldVal = node.oldVal ?? "";
      const newVal = node.newVal ?? "";
      return [
        makeFinding(ctx, {
          ruleId: "safety/alter-enum-rename-value",
          severity: "high",
          title: `RENAME enum value ${enumName}.'${oldVal}' -> '${newVal}' is a silent app break`,
          message:
            `Application code that compares against \`'${oldVal}'\` as a string literal will stop matching ` +
            `the moment this migration runs, even though Postgres won't raise an error. Rename is essentially a ` +
            `column rename for enums — it needs an expand/contract rollout.`,
          affectedSymbols: [oldVal, newVal, enumName],
          recipe: {
            summary: `Add the new label, dual-write, migrate app code, then drop the old label.`,
            steps: [
              {
                phase: "expand",
                description: `Add the new value alongside the old.`,
                sql: `ALTER TYPE ${enumName} ADD VALUE IF NOT EXISTS '${newVal}';`,
              },
              {
                phase: "migrate-data",
                description: `Migrate existing rows and update app code to read both values.`,
                appCodeNote: `Replace every literal \`'${oldVal}'\` comparison and accept either spelling for one release cycle.`,
              },
              {
                phase: "contract",
                description: `Once no app or row references the old value, removal requires a type recreation — Postgres does not support DROP VALUE.`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/safety/alter-enum-rename-value",
        }),
      ];
    }

    // ADD VALUE
    const newVal = node.newVal ?? "";
    return [
      makeFinding(ctx, {
        ruleId: "safety/alter-enum-add-value",
        severity: "low",
        title: `ALTER TYPE ${enumName} ADD VALUE '${newVal}' must commit before use`,
        message:
          `Adding a value to an enum must commit before any statement that uses the new value, ` +
          `and historically cannot be run inside a transaction block at all. Most ORM migration runners ` +
          `wrap statements in a transaction by default — disable that for this step (Prisma \`--script\`, ` +
          `Knex \`disableTransactions\`, TypeORM \`transaction: false\`).`,
        affectedSymbols: [newVal, enumName],
        docsUrl: "https://mergebrake.dev/rules/safety/alter-enum-add-value",
      }),
    ];
  },
};
