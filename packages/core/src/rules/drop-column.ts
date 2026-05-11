import type { Finding } from "mergebrake-shared";
import type { Rule, RuleContext } from "./index.js";
import { splitStatements, matchAlterTableDropColumn } from "./sql-util.js";
import { camelize, snakeize } from "../recipes/symbol-variants.js";

export const dropColumnRule: Rule = {
  id: "destructive/drop-column",
  scan(ctx: RuleContext): Finding[] {
    const stmts = splitStatements(ctx.block.sql);
    const findings: Finding[] = [];
    for (const s of stmts) {
      const drops = matchAlterTableDropColumn(s.text);
      for (const drop of drops) {
        const symbolVariants = [
          drop.column,
          camelize(drop.column),
          snakeize(drop.column),
          `${drop.table}.${drop.column}`,
        ];

        findings.push({
          ruleId: "destructive/drop-column",
          severity: "critical",
          title: `DROP COLUMN ${drop.table}.${drop.column} is destructive`,
          message:
            `This migration drops column \`${drop.column}\` from \`${drop.table}\`. ` +
            `Dropping a column is irreversible: existing row data in that column will be permanently deleted, ` +
            `and any application code still reading or writing the column will start failing the moment this deploys. ` +
            `MergeBrake recommends an expand/contract rollout in at least two deploys.`,
          location: {
            file: ctx.block.sourceFile,
            line: ctx.block.startLine + s.startLine - 1,
          },
          ormStack: ctx.ormStack,
          dialect: ctx.dialect,
          affectedSymbols: dedupe(symbolVariants),
          crossRefs: [],
          recipe: {
            summary:
              `Split the column removal into two deploys (expand/contract). ` +
              `Stop writing to ${drop.column} first, deploy the app, then run the DROP in a follow-up migration.`,
            steps: [
              {
                phase: "expand",
                description:
                  `Deploy application code that no longer reads or writes \`${drop.column}\`. ` +
                  `Keep the column in the database. This deploy must reach 100% of replicas before step 2.`,
                appCodeNote:
                  `Remove all references to ${drop.column} from queries, ORM models, serializers, ` +
                  `validation schemas, and API responses. Search for the cross-references reported by MergeBrake.`,
              },
              {
                phase: "migrate-data",
                description:
                  `(Optional, recommended) Archive the column to cold storage if there is any chance ` +
                  `you'll regret deleting it. Postgres example: \`CREATE TABLE archive_${drop.table}_${drop.column} AS SELECT id, ${drop.column} FROM ${drop.table};\``,
                sql:
                  `-- Optional: archive before destruction\n` +
                  `CREATE TABLE archive_${drop.table}_${drop.column} AS\n` +
                  `  SELECT id, ${drop.column} FROM ${drop.table};\n`,
              },
              {
                phase: "contract",
                description:
                  `After step 1 has been live for at least one release cycle and you have verified ` +
                  `no application is reading the column (e.g. via query logs), run the destructive migration.`,
                sql: `ALTER TABLE ${drop.table} DROP COLUMN ${drop.column};\n`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/destructive/drop-column",
        });
      }
    }
    return findings;
  },
};

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
