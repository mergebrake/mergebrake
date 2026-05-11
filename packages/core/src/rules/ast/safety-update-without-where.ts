import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import { isUpdateStmt, relationName } from "../../parsers/postgres-ast.js";

/**
 * An UPDATE without a WHERE clause inside a migration is one of two things:
 * either a backfill that should be batched (touching every row in a single
 * transaction holds row locks for the duration, fills up WAL, and bloats the
 * table), or a typo. Either way the reviewer needs to see it.
 */
export const astUpdateWithoutWhere: AstRule = {
  id: "safety/update-without-where",
  scan(ctx) {
    if (!isUpdateStmt(ctx.statement)) return [];
    const node = ctx.statement.node;
    if (node.whereClause) return [];
    const table = relationName(node.relation);
    if (!table) return [];
    return [
      makeFinding(ctx, {
        ruleId: "safety/update-without-where",
        severity: "high",
        title: `UPDATE ${table} without WHERE touches every row in one transaction`,
        message:
          `An \`UPDATE\` without a \`WHERE\` clause inside a migration locks every row of \`${table}\` ` +
          `for the duration of the migration transaction. On a large table this means lock contention with ` +
          `application writes, bloated WAL, and a long-running transaction that blocks autovacuum. ` +
          `Batch the backfill (a few thousand rows per transaction) or, if you genuinely need every row ` +
          `updated atomically, add a \`WHERE\` clause that documents intent.`,
        affectedSymbols: [table],
        recipe: {
          summary: `Batch the backfill in chunks; let the runner commit between chunks.`,
          steps: [
            {
              phase: "migrate-data",
              description: `Run this statement repeatedly outside the schema migration transaction until it updates zero rows.`,
              sql:
                `-- Example batched backfill. Run repeatedly; do not wrap the loop\n` +
                `-- in a migration transaction.\n` +
                `WITH batch AS (\n` +
                `  SELECT ctid\n` +
                `  FROM ${table}\n` +
                `  WHERE <condition>\n` +
                `  LIMIT 5000\n` +
                `)\n` +
                `UPDATE ${table} AS target\n` +
                `SET <column> = <value>\n` +
                `FROM batch\n` +
                `WHERE target.ctid = batch.ctid;`,
            },
          ],
        },
        docsUrl: "https://mergebrake.dev/rules/safety/update-without-where",
      }),
    ];
  },
};
