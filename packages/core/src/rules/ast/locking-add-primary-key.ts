import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  type Constraint,
} from "../../parsers/postgres-ast.js";

/**
 * `ALTER TABLE ... ADD PRIMARY KEY (...)` builds a unique index inline under
 * ACCESS EXCLUSIVE and additionally sets the column(s) NOT NULL with a full
 * table scan. On a sizeable table this is one of the most painful single
 * statements you can land in production.
 */
export const astAddPrimaryKey: AstRule = {
  id: "locking/add-primary-key",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_AddConstraint") continue;
      const constraint = (cmd.def as { Constraint?: Constraint } | undefined)
        ?.Constraint;
      if (!constraint || constraint.contype !== "CONSTR_PRIMARY") continue;
      if (constraint.indexname) continue; // USING INDEX path is safer

      const conname = constraint.conname ?? "<primary_key>";
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/add-primary-key",
          severity: "high",
          title: `ADD PRIMARY KEY ${conname} on ${table} blocks the whole table`,
          message:
            `Adding a PRIMARY KEY inline forces Postgres to build the supporting unique index and ` +
            `to validate NOT NULL on every row, all under ACCESS EXCLUSIVE on \`${table}\`. ` +
            `Reads and writes block for the duration. Build the unique index concurrently first, ` +
            `then attach it with \`USING INDEX\`.`,
          affectedSymbols: [conname, table],
          recipe: {
            summary: `Build the supporting unique index online, then promote it to PRIMARY KEY.`,
            steps: [
              {
                phase: "expand",
                description: `Build the unique index concurrently (cannot run inside a migration transaction).`,
                sql: `CREATE UNIQUE INDEX CONCURRENTLY ${conname}_idx\n  ON ${table} (<pk_columns>);`,
              },
              {
                phase: "contract",
                description: `Promote the index. Postgres will still validate NOT NULL on the PK columns, so ensure those are non-null first.`,
                sql: `ALTER TABLE ${table}\n  ADD CONSTRAINT ${conname} PRIMARY KEY USING INDEX ${conname}_idx;`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/locking/add-primary-key",
        }),
      );
    }
    return findings;
  },
};
