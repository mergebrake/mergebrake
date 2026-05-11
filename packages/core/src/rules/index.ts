import type {
  Finding,
  OrmStack,
  DatabaseDialect,
} from "@mergebrake/shared";
import type { SqlBlock } from "../parsers/orm-sql-extractor.js";
import { dropColumnRule } from "./drop-column.js";
import { addNotNullWithoutDefaultRule } from "./add-not-null-without-default.js";
import { renameColumnRule } from "./rename-column.js";
import { createIndexNonConcurrentRule } from "./create-index-non-concurrent.js";
import { dropTableRule } from "./drop-table.js";

export interface RuleContext {
  ormStack: OrmStack;
  dialect: DatabaseDialect;
  block: SqlBlock;
}

export interface Rule {
  id: string;
  /** Run rule against a SQL block; return findings with empty `crossRefs` (filled later). */
  scan(ctx: RuleContext): Finding[];
}

export const rules: Rule[] = [
  dropColumnRule,
  dropTableRule,
  renameColumnRule,
  addNotNullWithoutDefaultRule,
  createIndexNonConcurrentRule,
];

export function runRules(input: {
  sqlBlocks: SqlBlock[];
  ormStack: OrmStack;
  dialect: DatabaseDialect;
}): Finding[] {
  const findings: Finding[] = [];
  for (const block of input.sqlBlocks) {
    for (const rule of rules) {
      const ruleFindings = rule.scan({
        ormStack: input.ormStack,
        dialect: input.dialect,
        block,
      });
      findings.push(...ruleFindings);
    }
  }
  return findings;
}
