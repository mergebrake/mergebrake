import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  type Constraint,
} from "../../parsers/postgres-ast.js";

/**
 * `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (...)` (without USING INDEX) makes
 * Postgres build the supporting index inline under an ACCESS EXCLUSIVE lock.
 * The safe pattern is to build the unique index CONCURRENTLY in its own step,
 * then attach it via `ADD CONSTRAINT ... USING INDEX`.
 */
export const astAddUniqueConstraint: AstRule = {
  id: "locking/add-unique-constraint",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_AddConstraint") continue;
      const constraint = (cmd.def as { Constraint?: Constraint } | undefined)
        ?.Constraint;
      if (!constraint || constraint.contype !== "CONSTR_UNIQUE") continue;
      if (constraint.indexname) continue; // USING INDEX path is safe

      const conname = constraint.conname ?? "<unnamed_unique>";
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/add-unique-constraint",
          severity: "high",
          title: `ADD UNIQUE constraint ${conname} on ${table} builds the index under ACCESS EXCLUSIVE`,
          message:
            `Adding a unique constraint inline forces Postgres to build the supporting index while holding ` +
            `ACCESS EXCLUSIVE on \`${table}\`, blocking reads and writes for the duration. ` +
            `Build a unique index \`CONCURRENTLY\` in a separate step, then attach it with \`USING INDEX\`.`,
          affectedSymbols: [conname, table],
          recipe: {
            summary: `Build the unique index concurrently, then attach as a constraint.`,
            steps: [
              {
                phase: "expand",
                description: `Build the unique index without locks (cannot run inside a migration transaction).`,
                sql: `CREATE UNIQUE INDEX CONCURRENTLY ${conname}_idx\n  ON ${table} (<columns>);`,
              },
              {
                phase: "contract",
                description: `Promote the existing index to a constraint; this only takes a brief ACCESS EXCLUSIVE.`,
                sql: `ALTER TABLE ${table}\n  ADD CONSTRAINT ${conname} UNIQUE USING INDEX ${conname}_idx;`,
              },
            ],
          },
          docsUrl:
            "https://mergebrake.dev/rules/locking/add-unique-constraint",
        }),
      );
    }
    return findings;
  },
};
