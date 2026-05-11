import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isRenameStmt,
  relationName,
} from "../../parsers/postgres-ast.js";
import { camelize, snakeize } from "../../recipes/symbol-variants.js";

export const astRenameColumn: AstRule = {
  id: "destructive/rename-column",
  scan(ctx) {
    if (!isRenameStmt(ctx.statement)) return [];
    const node = ctx.statement.node;
    if (node.renameType !== "OBJECT_COLUMN") return [];
    const table = relationName(node.relation);
    const fromColumn = node.subname ?? "";
    const toColumn = node.newname ?? "";
    if (!table || !fromColumn || !toColumn) return [];
    return [
      makeFinding(ctx, {
        ruleId: "destructive/rename-column",
        severity: "high",
        title: `RENAME COLUMN ${table}.${fromColumn} -> ${toColumn} is unsafe in a single deploy`,
        message:
          `Renaming a column is atomic at the database level but not at the application level: ` +
          `between the moment the migration runs and the moment the new app code reaches every replica, ` +
          `requests that hit old replicas will reference \`${fromColumn}\` and fail. ` +
          `Use an expand/contract sequence to make the rename zero-downtime.`,
        affectedSymbols: [
          fromColumn,
          camelize(fromColumn),
          snakeize(fromColumn),
          `${table}.${fromColumn}`,
        ],
        recipe: {
          summary: `Three-phase expand/contract: add the new column, dual-write, then drop the old column.`,
          steps: [
            {
              phase: "expand",
              description: `Add \`${toColumn}\` as a nullable column alongside \`${fromColumn}\`. Backfill values from the old column.`,
              sql:
                `ALTER TABLE ${table} ADD COLUMN ${toColumn} <same_type>;\n` +
                `UPDATE ${table} SET ${toColumn} = ${fromColumn};\n`,
            },
            {
              phase: "migrate-data",
              description: `Deploy app code that writes to both columns and reads from \`${toColumn}\` with a fallback to \`${fromColumn}\`. Wait for one full release cycle.`,
              appCodeNote: `Search MergeBrake's cross-references for every read/write of \`${fromColumn}\` and add a parallel reference to \`${toColumn}\`.`,
            },
            {
              phase: "contract",
              description: `Once all replicas are on the new code and \`${fromColumn}\` is no longer read, drop it.`,
              sql: `ALTER TABLE ${table} DROP COLUMN ${fromColumn};`,
            },
          ],
        },
        docsUrl: "https://mergebrake.dev/rules/destructive/rename-column",
      }),
    ];
  },
};
