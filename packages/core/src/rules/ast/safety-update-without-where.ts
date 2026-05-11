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
          summary: `Batch the backfill in chunks; commit each chunk.`,
          steps: [
            {
              phase: "migrate-data",
              description: `Use a key-window batch loop instead of a single statement. Commit between batches.`,
              sql:
                `-- Example batched backfill (run outside the migration transaction)\n` +
                `DO $$\n` +
                `DECLARE\n` +
                `  last_id bigint := 0;\n` +
                `  affected int;\n` +
                `BEGIN\n` +
                `  LOOP\n` +
                `    UPDATE ${table}\n` +
                `      SET <column> = <value>\n` +
                `    WHERE id > last_id AND id <= last_id + 5000;\n` +
                `    GET DIAGNOSTICS affected = ROW_COUNT;\n` +
                `    EXIT WHEN affected = 0;\n` +
                `    last_id := last_id + 5000;\n` +
                `    COMMIT;\n` +
                `  END LOOP;\n` +
                `END$$;`,
            },
          ],
        },
        docsUrl: "https://mergebrake.dev/rules/safety/update-without-where",
      }),
    ];
  },
};
