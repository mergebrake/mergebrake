import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  type Constraint,
} from "../../parsers/postgres-ast.js";

/**
 * Adding a FOREIGN KEY without NOT VALID forces Postgres to scan and lock every
 * row in the table to validate the constraint before the migration returns.
 * On any non-trivial table this is minutes of blocking writes. The standard
 * Postgres advice is to add the constraint NOT VALID first, then VALIDATE it
 * separately (which only requires a SHARE UPDATE EXCLUSIVE lock).
 */
export const astAddForeignKeyWithoutNotValid: AstRule = {
  id: "locking/add-foreign-key-without-not-valid",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_AddConstraint") continue;
      const constraint = (cmd.def as { Constraint?: Constraint } | undefined)
        ?.Constraint;
      if (!constraint || constraint.contype !== "CONSTR_FOREIGN") continue;
      if (constraint.skip_validation === true) continue;

      const conname = constraint.conname ?? "<unnamed>";
      const refTable = constraint.pktable?.relname ?? "<ref_table>";
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/add-foreign-key-without-not-valid",
          severity: "high",
          title: `ADD FOREIGN KEY ${conname} on ${table} blocks writes during validation`,
          message:
            `Adding a foreign key without \`NOT VALID\` forces Postgres to scan and lock every row in \`${table}\` ` +
            `to verify the new constraint against \`${refTable}\` before the migration returns. ` +
            `That can mean minutes of write-blocking on a large table. Split into two statements: ` +
            `add the FK as \`NOT VALID\` (immediate, only future rows are checked), then \`VALIDATE CONSTRAINT\` ` +
            `online afterward.`,
          affectedSymbols: [conname, table, refTable],
          recipe: {
            summary: `Two-step add: NOT VALID first, then VALIDATE.`,
            steps: [
              {
                phase: "expand",
                description: `Add the foreign key with NOT VALID so new rows are checked but the migration doesn't scan the whole table.`,
                sql:
                  `ALTER TABLE ${table}\n` +
                  `  ADD CONSTRAINT ${conname}\n` +
                  `  FOREIGN KEY (...) REFERENCES ${refTable} (...)\n` +
                  `  NOT VALID;`,
              },
              {
                phase: "contract",
                description: `Validate the constraint online (SHARE UPDATE EXCLUSIVE, doesn't block reads/writes).`,
                sql: `ALTER TABLE ${table} VALIDATE CONSTRAINT ${conname};`,
              },
            ],
          },
          docsUrl:
            "https://mergebrake.dev/rules/locking/add-foreign-key-without-not-valid",
        }),
      );
    }
    return findings;
  },
};
