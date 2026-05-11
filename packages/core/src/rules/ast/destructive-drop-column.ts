import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
} from "../../parsers/postgres-ast.js";
import { camelize, snakeize } from "../../recipes/symbol-variants.js";

export const astDropColumn: AstRule = {
  id: "destructive/drop-column",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_DropColumn") continue;
      const column = cmd.name ?? "";
      if (!column || !table) continue;

      const cascade = cmd.behavior === "DROP_CASCADE";
      findings.push(
        makeFinding(ctx, {
          ruleId: "destructive/drop-column",
          severity: "critical",
          title: `DROP COLUMN ${table}.${column} is destructive`,
          message:
            `This migration drops column \`${column}\` from \`${table}\`` +
            (cascade ? " with CASCADE" : "") +
            `. Existing row data in that column will be permanently deleted, and any application code still reading or writing the column will start failing the moment this deploys. MergeBrake recommends an expand/contract rollout in at least two deploys.`,
          affectedSymbols: [
            column,
            camelize(column),
            snakeize(column),
            `${table}.${column}`,
          ],
          recipe: {
            summary: `Split the column removal into two deploys (expand/contract). Stop writing to ${column} first, deploy the app, then run the DROP in a follow-up migration.`,
            steps: [
              {
                phase: "expand",
                description: `Deploy application code that no longer reads or writes \`${column}\`. Keep the column in the database. This deploy must reach 100% of replicas before step 2.`,
                appCodeNote: `Remove all references to ${column} from queries, ORM models, serializers, validation schemas, and API responses. Search MergeBrake's cross-references.`,
              },
              {
                phase: "migrate-data",
                description: `(Optional, recommended) Archive the column to cold storage if there is any chance you'll regret deleting it.`,
                sql:
                  `-- Optional: archive before destruction\n` +
                  `CREATE TABLE archive_${table.replace(/\./g, "_")}_${column} AS\n` +
                  `  SELECT id, ${column} FROM ${table};\n`,
              },
              {
                phase: "contract",
                description: `After step 1 has been live for at least one release cycle and you have verified no application is reading the column, run the destructive migration.`,
                sql: `ALTER TABLE ${table} DROP COLUMN ${column};\n`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/destructive/drop-column",
        }),
      );
    }
    return findings;
  },
};
