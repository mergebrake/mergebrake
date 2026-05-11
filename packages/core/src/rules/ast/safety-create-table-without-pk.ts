import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";

interface CreateStmt {
  relation?: { relname?: string; schemaname?: string };
  tableElts?: Array<{
    ColumnDef?: {
      colname?: string;
      constraints?: Array<{ Constraint?: { contype?: string } }>;
    };
    Constraint?: { contype?: string };
  }>;
}

/**
 * `CREATE TABLE` without a PRIMARY KEY is allowed by Postgres but is almost
 * always a mistake on application tables. It breaks logical replication
 * (REPLICA IDENTITY needs a primary key or a manually-set replica identity),
 * confuses many ORMs, and makes upsert/idempotency patterns impossible to
 * express cleanly. Worth a low-severity nudge.
 *
 * Note: this fires for SELECT-driven `CREATE TABLE AS` only when we can
 * inspect the column list — we deliberately ignore `CREATE TABLE … (LIKE …)`
 * and inherited tables to avoid noise.
 */
export const astCreateTableWithoutPk: AstRule = {
  id: "safety/create-table-without-primary-key",
  scan(ctx) {
    if (ctx.statement.kind !== "CreateStmt") return [];
    const node = ctx.statement.node as CreateStmt;
    const table = relName(node);
    if (!table) return [];
    const elts = node.tableElts ?? [];
    if (elts.length === 0) return []; // CREATE TABLE AS / inherited

    if (hasPrimaryKey(elts)) return [];

    return [
      makeFinding(ctx, {
        ruleId: "safety/create-table-without-primary-key",
        severity: "low",
        title: `CREATE TABLE ${table} has no PRIMARY KEY`,
        message:
          `New table \`${table}\` was created without a PRIMARY KEY. Postgres allows this, but the lack of one breaks logical replication, ` +
          `confuses most ORMs, prevents \`ON CONFLICT (id)\` upserts, and makes future debugging harder ` +
          `(row identity has to fall back to a synthetic ctid). Pick a primary key column or composite.`,
        affectedSymbols: [table],
        recipe: {
          summary: `Add a PRIMARY KEY column or constraint.`,
          steps: [
            {
              phase: "expand",
              description: `If the natural identifier is known, declare it inline.`,
              sql: `ALTER TABLE ${table} ADD COLUMN id BIGSERIAL PRIMARY KEY;`,
            },
          ],
        },
        docsUrl:
          "https://mergebrake.dev/rules/safety/create-table-without-primary-key",
      }),
    ];
  },
};

function relName(node: CreateStmt): string {
  if (!node.relation?.relname) return "";
  return node.relation.schemaname
    ? `${node.relation.schemaname}.${node.relation.relname}`
    : node.relation.relname;
}

function hasPrimaryKey(elts: NonNullable<CreateStmt["tableElts"]>): boolean {
  for (const elt of elts) {
    if (elt.Constraint?.contype === "CONSTR_PRIMARY") return true;
    const inline = elt.ColumnDef?.constraints ?? [];
    for (const c of inline) {
      if (c.Constraint?.contype === "CONSTR_PRIMARY") return true;
    }
  }
  return false;
}
