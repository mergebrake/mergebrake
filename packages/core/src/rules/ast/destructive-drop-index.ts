import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import { isDropStmt } from "../../parsers/postgres-ast.js";

/**
 * `DROP INDEX` is not destructive of row data, but on a hot query path it can
 * silently turn a millisecond query into a sequential scan. Worth flagging
 * because the failure is observable only under load — the migration succeeds
 * cleanly and the regression shows up an hour later in p99 latency.
 *
 * We separately handle the standalone `DROP INDEX` statement and the
 * `ALTER TABLE ... DROP CONSTRAINT` path (covered by `destructive/drop-constraint`).
 */
export const astDropIndex: AstRule = {
  id: "destructive/drop-index",
  scan(ctx) {
    if (!isDropStmt(ctx.statement)) return [];
    const node = ctx.statement.node;
    if (node.removeType !== "OBJECT_INDEX") return [];

    const findings = [];
    const concurrent = node.concurrent === true;
    const ifExists = node.missing_ok === true;
    for (const obj of node.objects ?? []) {
      const name = extractIndexName(obj);
      if (!name) continue;
      findings.push(
        makeFinding(ctx, {
          ruleId: "destructive/drop-index",
          severity: "medium",
          title: `DROP INDEX ${name}${concurrent ? " CONCURRENTLY" : ""} can regress query plans`,
          message:
            `Dropping \`${name}\`${ifExists ? " (IF EXISTS)" : ""} ` +
            (concurrent
              ? `is safe at the lock level (CONCURRENTLY avoids ACCESS EXCLUSIVE), but `
              : `takes an ACCESS EXCLUSIVE on the underlying table briefly, and `) +
            `it removes a query plan input. Any read that depended on this index will fall back to a sequential scan ` +
            `or a worse plan. Verify with EXPLAIN that hot queries don't rely on it before merging.`,
          affectedSymbols: [name],
          recipe: {
            summary: `Confirm no production query relies on the index, then drop it concurrently if you skipped that.`,
            steps: concurrent
              ? [
                  {
                    phase: "expand",
                    description: `Run pg_stat_user_indexes (or a similar check) for the index; idx_scan should be 0 over your retention window.`,
                  },
                ]
              : [
                  {
                    phase: "expand",
                    description: `Run pg_stat_user_indexes (or a similar check) for the index; idx_scan should be 0 over your retention window.`,
                  },
                  {
                    phase: "contract",
                    description: `Use CONCURRENTLY to avoid the brief lock. Cannot run inside a transaction.`,
                    sql: `DROP INDEX CONCURRENTLY ${name};`,
                  },
                ],
          },
          docsUrl: "https://mergebrake.dev/rules/destructive/drop-index",
        }),
      );
    }
    return findings;
  },
};

function extractIndexName(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  // libpg_query wraps qualified names in { List: { items: [{ String: { sval } }] } }
  if ("List" in o && o.List && typeof o.List === "object") {
    const items = (o.List as { items?: unknown[] }).items ?? [];
    const parts = items
      .map((it) =>
        (it as { String?: { sval?: string } }).String?.sval ?? null,
      )
      .filter((s): s is string => Boolean(s));
    return parts.length ? parts.join(".") : null;
  }
  if ("String" in o) {
    return (o as { String?: { sval?: string } }).String?.sval ?? null;
  }
  return null;
}
