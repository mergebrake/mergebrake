import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import { isDropStmt } from "../../parsers/postgres-ast.js";

export const astDropTable: AstRule = {
  id: "destructive/drop-table",
  scan(ctx) {
    if (!isDropStmt(ctx.statement)) return [];
    const node = ctx.statement.node;
    if (node.removeType !== "OBJECT_TABLE") return [];

    const findings = [];
    const cascade = node.behavior === "DROP_CASCADE";
    const ifExists = node.missing_ok === true;
    for (const objList of node.objects ?? []) {
      const tableName = extractTableNameFromDropObject(objList);
      if (!tableName) continue;
      findings.push(
        makeFinding(ctx, {
          ruleId: "destructive/drop-table",
          severity: "critical",
          title: `DROP TABLE ${tableName}${cascade ? " CASCADE" : ""} is destructive`,
          message:
            `This migration drops the table \`${tableName}\`${cascade ? " with CASCADE" : ""}` +
            (ifExists ? " (IF EXISTS)" : "") +
            `. All rows are permanently deleted` +
            (cascade
              ? `, and CASCADE will also drop foreign-key-dependent objects in other tables — this can silently destroy data far beyond \`${tableName}\`.`
              : `, and any foreign keys referencing this table must already be removed.`) +
            ` Run an expand/contract rollout: stop all reads/writes first, then drop in a follow-up release.`,
          affectedSymbols: [tableName],
          recipe: {
            summary:
              `Two-deploy expand/contract: stop using the table, ship the app, then drop the table.`,
            steps: [
              {
                phase: "expand",
                description: `Deploy application code that no longer reads or writes \`${tableName}\`. Verify with logs/metrics that traffic to this table is zero for at least one release cycle.`,
                appCodeNote: `Remove repository classes, ORM models, foreign keys, indexes, and views that reference ${tableName}.`,
              },
              {
                phase: "migrate-data",
                description: `Archive the data if there is any chance of needing it later.`,
                sql: `CREATE TABLE archive_${tableName.replace(/\./g, "_")} AS SELECT * FROM ${tableName};\n`,
              },
              {
                phase: "contract",
                description: `Once verified that no traffic reaches the table, drop it.`,
                sql: cascade
                  ? `DROP TABLE ${tableName} CASCADE;`
                  : `DROP TABLE ${tableName};`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/destructive/drop-table",
        }),
      );
    }
    return findings;
  },
};

/**
 * The drop list for tables is shaped like:
 *   [{ List: { items: [{ String: { sval: "schema" } }, { String: { sval: "tbl" } }] } }]
 * For unqualified names you only get one String element. We tolerate both.
 */
function extractTableNameFromDropObject(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  // newer libpg_query versions return `List` wrappers
  if ("List" in o && typeof o.List === "object" && o.List !== null) {
    const items = (o.List as { items?: unknown[] }).items ?? [];
    return joinStringNodes(items);
  }
  // Some shapes return raw arrays
  if (Array.isArray(obj)) {
    return joinStringNodes(obj);
  }
  if ("String" in o && o.String && typeof o.String === "object") {
    const sval = (o.String as { sval?: string }).sval;
    return sval ?? null;
  }
  return null;
}

function joinStringNodes(items: unknown[]): string | null {
  const parts: string[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const s = (it as { String?: { sval?: string } }).String;
    if (s?.sval) parts.push(s.sval);
  }
  return parts.length ? parts.join(".") : null;
}
