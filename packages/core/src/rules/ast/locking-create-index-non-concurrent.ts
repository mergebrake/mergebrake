import type { AstRule } from "./index.js";
import { makeFinding, isTableFreshInBlock } from "./_shared.js";
import {
  isIndexStmt,
  relationName,
} from "../../parsers/postgres-ast.js";

export const astCreateIndexNonConcurrent: AstRule = {
  id: "locking/create-index-non-concurrent",
  scan(ctx) {
    if (ctx.dialect !== "postgres") return []; // CONCURRENTLY is Postgres-only
    if (!isIndexStmt(ctx.statement)) return [];
    const node = ctx.statement.node;
    if (node.concurrent === true) return [];
    const table = relationName(node.relation);
    const indexName = node.idxname ?? "<unnamed>";
    const unique = node.unique === true;
    // A locking SHARE lock on a table that was created in this same migration
    // block can't block anything: the table has no rows yet, no writers. Demote
    // to info so the finding stays visible (educational) but stops dominating
    // the risk score on initial-migration runs.
    const fresh = isTableFreshInBlock(ctx, table);
    const severity = fresh ? "info" : unique ? "high" : "medium";
    const titleSuffix = fresh ? " (fresh table — no real lock risk)" : "";
    const messageExtra = fresh
      ? `\n\nThis index is built on \`${table}\`, which is being created in the same migration. With no existing rows and no concurrent writers there is no real lock to contend for, so MergeBrake demotes this finding to \`info\`. The note is kept so future migrations on the same table don't accidentally inherit the non-CONCURRENTLY pattern.`
      : "";
    return [
      makeFinding(ctx, {
        ruleId: "locking/create-index-non-concurrent",
        severity,
        title: `CREATE ${unique ? "UNIQUE " : ""}INDEX ${indexName} on ${table} blocks writes (missing CONCURRENTLY)${titleSuffix}`,
        message:
          `\`CREATE ${unique ? "UNIQUE " : ""}INDEX\` without \`CONCURRENTLY\` takes a SHARE lock on \`${table}\` that blocks INSERT, UPDATE, and DELETE for the duration of the build. ` +
          (unique
            ? `Unique indexes also take a brief ACCESS EXCLUSIVE lock at the end. `
            : ``) +
          `On a large table this can mean minutes of write-locked traffic. Use \`CREATE INDEX CONCURRENTLY\` to build the index online.` +
          messageExtra,
        affectedSymbols: [indexName, table],
        recipe: {
          summary: `Rewrite the statement with CONCURRENTLY and run it outside the migration transaction.`,
          steps: [
            {
              phase: "expand",
              description:
                `Run the index creation in its own session (no BEGIN/COMMIT around it). ` +
                `Most ORM migration tools wrap statements in a transaction by default, so you must explicitly disable that for this step ` +
                `(Prisma: separate \`--script\` migration; Knex: \`disableTransactions\`; TypeORM: \`transaction: false\`).`,
              sql: `CREATE ${unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${table} (<columns>);`,
            },
            {
              phase: "contract",
              description: `If the previous step ever fails partway, Postgres leaves an INVALID index behind. Drop it before retrying.`,
              sql: `DROP INDEX CONCURRENTLY ${indexName};`,
            },
          ],
        },
        docsUrl: "https://mergebrake.dev/rules/locking/create-index-non-concurrent",
      }),
    ];
  },
};
