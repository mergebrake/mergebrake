import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
  type Constraint,
} from "../../parsers/postgres-ast.js";

/**
 * Adding a CHECK constraint without `NOT VALID` forces a full table scan under
 * ACCESS EXCLUSIVE to validate the existing rows. Split into NOT VALID first,
 * VALIDATE later. (Same pattern as foreign keys.)
 */
export const astAddCheckWithoutNotValid: AstRule = {
  id: "locking/add-check-without-not-valid",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_AddConstraint") continue;
      const constraint = (cmd.def as { Constraint?: Constraint } | undefined)
        ?.Constraint;
      if (!constraint || constraint.contype !== "CONSTR_CHECK") continue;
      if (constraint.skip_validation === true) continue;

      const conname = constraint.conname ?? "<check>";
      findings.push(
        makeFinding(ctx, {
          ruleId: "locking/add-check-without-not-valid",
          severity: "medium",
          title: `ADD CHECK constraint ${conname} on ${table} validates against every existing row`,
          message:
            `A CHECK constraint added without \`NOT VALID\` scans every row in \`${table}\` and ` +
            `blocks writes for the duration. Add the constraint NOT VALID first, then \`VALIDATE CONSTRAINT\` ` +
            `online (SHARE UPDATE EXCLUSIVE).`,
          affectedSymbols: [conname, table],
          recipe: {
            summary: `Split into a fast NOT VALID add and an online VALIDATE.`,
            steps: [
              {
                phase: "expand",
                description: `Add the constraint NOT VALID — instant, only future rows are checked.`,
                sql: `ALTER TABLE ${table} ADD CONSTRAINT ${conname} CHECK (<expr>) NOT VALID;`,
              },
              {
                phase: "contract",
                description: `Validate the constraint online once known violations are cleaned up.`,
                sql: `ALTER TABLE ${table} VALIDATE CONSTRAINT ${conname};`,
              },
            ],
          },
          docsUrl:
            "https://mergebrake.dev/rules/locking/add-check-without-not-valid",
        }),
      );
    }
    return findings;
  },
};
