import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import { isTruncateStmt, relationName } from "../../parsers/postgres-ast.js";

/**
 * TRUNCATE is destructive: it deletes every row in the target table(s). It is
 * transactional in modern Postgres, but it is still a high-blast-radius data
 * operation that almost never belongs in an automated schema migration.
 */
export const astTruncate: AstRule = {
  id: "destructive/truncate",
  scan(ctx) {
    if (!isTruncateStmt(ctx.statement)) return [];
    const node = ctx.statement.node;
    const tables = (node.relations ?? [])
      .map((r) => relationName(r.RangeVar))
      .filter(Boolean);
    if (tables.length === 0) return [];
    const cascade = node.behavior === "DROP_CASCADE";
    const tableList = tables.join(", ");
    return [
      makeFinding(ctx, {
        ruleId: "destructive/truncate",
        severity: "critical",
        title: `TRUNCATE ${tableList}${cascade ? " CASCADE" : ""} deletes every row`,
        message:
          `\`TRUNCATE\` empties the listed table(s) entirely` +
          (cascade
            ? `, and CASCADE recursively truncates dependent tables - data loss far beyond the named relations.`
            : ``) +
          ` In an automated migration this is almost never what you want. If you really need to empty a table, prefer ` +
          `\`DELETE FROM ... WHERE\` (recoverable, auditable) or stage the change behind an application-level toggle.`,
        affectedSymbols: tables,
        recipe: {
          summary: `Replace TRUNCATE with a scoped DELETE or move it out of the migration entirely.`,
          steps: [
            {
              phase: "expand",
              description: `If you truly need to clear data, do it with a WHERE clause so the change is auditable and reversible.`,
              sql: `DELETE FROM ${tables[0] ?? "<table>"} WHERE <condition>;`,
            },
            {
              phase: "contract",
              description: `Verify with an explicit row-count check after the deletion; never assume.`,
              sql: `SELECT COUNT(*) FROM ${tables[0] ?? "<table>"};`,
            },
          ],
        },
        docsUrl: "https://mergebrake.dev/rules/destructive/truncate",
      }),
    ];
  },
};
