import type { Finding } from "mergebrake-shared";
import type { Rule, RuleContext } from "./index.js";
import { splitStatements, matchDropTable } from "./sql-util.js";

export const dropTableRule: Rule = {
  id: "destructive/drop-table",
  scan(ctx: RuleContext): Finding[] {
    const stmts = splitStatements(ctx.block.sql);
    const findings: Finding[] = [];
    for (const s of stmts) {
      const drops = matchDropTable(s.text);
      for (const drop of drops) {
        findings.push({
          ruleId: "destructive/drop-table",
          severity: "critical",
          title: `DROP TABLE ${drop.table}${drop.cascade ? " CASCADE" : ""} is destructive`,
          message:
            `This migration drops the table \`${drop.table}\`${drop.cascade ? " with CASCADE" : ""}. ` +
            `All rows are permanently deleted, and ` +
            (drop.cascade
              ? `CASCADE will also drop foreign-key-dependent objects in other tables — this can silently destroy data far beyond \`${drop.table}\`. `
              : `any foreign keys referencing this table must already be removed. `) +
            `Run an expand/contract rollout: stop all reads/writes first, then drop in a follow-up release.`,
          location: {
            file: ctx.block.sourceFile,
            line: ctx.block.startLine + s.startLine - 1,
          },
          ormStack: ctx.ormStack,
          dialect: ctx.dialect,
          affectedSymbols: [drop.table],
          crossRefs: [],
          recipe: {
            summary: `Two-deploy expand/contract: stop using the table, ship the app, then drop the table.`,
            steps: [
              {
                phase: "expand",
                description:
                  `Deploy application code that no longer reads or writes \`${drop.table}\`. Verify with logs/metrics that traffic to this table is zero for at least one release cycle.`,
                appCodeNote: `Remove repository classes, ORM models, foreign keys, indexes, and views that reference ${drop.table}. Search MergeBrake's cross-references.`,
              },
              {
                phase: "migrate-data",
                description: `Archive the data if there is any chance of needing it later.`,
                sql: `CREATE TABLE archive_${drop.table} AS SELECT * FROM ${drop.table};\n`,
              },
              {
                phase: "contract",
                description: `Once verified that no traffic reaches the table, drop it.`,
                sql: drop.cascade
                  ? `DROP TABLE ${drop.table} CASCADE;`
                  : `DROP TABLE ${drop.table};`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/destructive/drop-table",
        });
      }
    }
    return findings;
  },
};
