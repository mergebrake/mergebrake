import type { AstRule } from "./index.js";
import { makeFinding } from "./_shared.js";
import {
  isAlterTable,
  relationName,
} from "../../parsers/postgres-ast.js";

/**
 * `ALTER TABLE ... DROP CONSTRAINT` removes a check, unique, foreign key, or
 * primary key constraint. None of those drop row data, but each one represents
 * an invariant your application code may still rely on. Removing the invariant
 * before the app stops trusting it is a classic data-corruption pattern (the
 * cleanest example: drop a CHECK that enforces a status enum, then watch
 * arbitrary values arrive while old replicas still read the column).
 */
export const astDropConstraint: AstRule = {
  id: "destructive/drop-constraint",
  scan(ctx) {
    if (!isAlterTable(ctx.statement)) return [];
    const findings = [];
    const table = relationName(ctx.statement.node.relation);
    for (const c of ctx.statement.node.cmds ?? []) {
      const cmd = c.AlterTableCmd;
      if (cmd?.subtype !== "AT_DropConstraint") continue;
      const conname = cmd.name ?? "<unnamed>";
      const cascade = cmd.behavior === "DROP_CASCADE";
      findings.push(
        makeFinding(ctx, {
          ruleId: "destructive/drop-constraint",
          severity: "high",
          title: `DROP CONSTRAINT ${conname} on ${table}${cascade ? " CASCADE" : ""} removes an invariant`,
          message:
            `Dropping a constraint does not delete row data, but it does silently relax an invariant the application may still rely on. ` +
            (cascade
              ? `Worse, CASCADE will drop dependent foreign keys in other tables — invariants you might not realise you were enforcing. `
              : ``) +
            `Verify with reviewers that no app code, ORM model, or background job assumes this constraint still exists before merging.`,
          affectedSymbols: [conname, table],
          recipe: {
            summary: `Defer the drop until the app no longer trusts the invariant.`,
            steps: [
              {
                phase: "expand",
                description: `Deploy app code that tolerates the invariant being absent (e.g. nullable values, weaker enums, soft FK semantics).`,
              },
              {
                phase: "contract",
                description: `Once the app has been live for a release cycle without relying on the constraint, drop it.`,
                sql: cascade
                  ? `ALTER TABLE ${table} DROP CONSTRAINT ${conname} CASCADE;`
                  : `ALTER TABLE ${table} DROP CONSTRAINT ${conname};`,
              },
            ],
          },
          docsUrl: "https://mergebrake.dev/rules/destructive/drop-constraint",
        }),
      );
    }
    return findings;
  },
};
