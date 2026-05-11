import type { Finding } from "mergebrake-shared";
import type { Rule, RuleContext } from "./index.js";
import { splitStatements, matchCreateIndexNonConcurrent } from "./sql-util.js";

export const createIndexNonConcurrentRule: Rule = {
  id: "locking/create-index-non-concurrent",
  scan(ctx: RuleContext): Finding[] {
    if (ctx.dialect !== "postgres") return []; // CONCURRENTLY is Postgres-specific
    const stmts = splitStatements(ctx.block.sql);
    const findings: Finding[] = [];
    for (const s of stmts) {
      const matches = matchCreateIndexNonConcurrent(s.text);
      for (const m of matches) {
        // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
        // Most ORM migration runners wrap migrations in BEGIN/COMMIT, so we must
        // also surface the transaction caveat in the recipe.
        findings.push({
          ruleId: "locking/create-index-non-concurrent",
          severity: "medium",
          title: `CREATE INDEX ${m.index} on ${m.table} blocks writes (missing CONCURRENTLY)`,
          message:
            `\`CREATE INDEX\` without \`CONCURRENTLY\` takes a SHARE lock on \`${m.table}\` that blocks INSERT, UPDATE, DELETE for the duration of the build. ` +
            `On a large table this can mean minutes of write-locked traffic. Use \`CREATE INDEX CONCURRENTLY\` to build the index online.`,
          location: {
            file: ctx.block.sourceFile,
            line: ctx.block.startLine + s.startLine - 1,
          },
          ormStack: ctx.ormStack,
          dialect: ctx.dialect,
          affectedSymbols: [m.index, m.table],
          crossRefs: [],
          recipe: {
            summary: `Rewrite the statement with CONCURRENTLY and run it outside the migration transaction.`,
            steps: [
              {
                phase: "expand",
                description:
                  `Run the index creation in its own session (no BEGIN/COMMIT around it). ` +
                  `Most ORM migration tools wrap statements in a transaction by default, so you must explicitly disable that for this step ` +
                  `(Prisma: separate \`--script\` migration; Knex: \`disableTransactions\`; TypeORM: \`transaction: false\`).`,
                sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${m.index} ON ${m.table} (<columns>);`,
              },
              {
                phase: "contract",
                description:
                  `If the previous step ever fails partway, Postgres leaves an INVALID index behind. ` +
                  `Drop it before retrying: \`DROP INDEX CONCURRENTLY ${m.index};\``,
              },
            ],
          },
          docsUrl:
            "https://mergebrake.dev/rules/locking/create-index-non-concurrent",
        });
      }
    }
    return findings;
  },
};
