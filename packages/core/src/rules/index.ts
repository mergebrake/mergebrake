import type {
  Finding,
  OrmStack,
  DatabaseDialect,
} from "mergebrake-shared";
import type { SqlBlock } from "../parsers/orm-sql-extractor.js";
import { parsePostgres } from "../parsers/postgres-ast.js";

import { dropColumnRule } from "./drop-column.js";
import { addNotNullWithoutDefaultRule } from "./add-not-null-without-default.js";
import { renameColumnRule } from "./rename-column.js";
import { createIndexNonConcurrentRule } from "./create-index-non-concurrent.js";
import { dropTableRule } from "./drop-table.js";

import { runAstRules } from "./ast/index.js";

/** Legacy rule contract: scans a raw SQL block with regex heuristics. */
export interface RuleContext {
  ormStack: OrmStack;
  dialect: DatabaseDialect;
  block: SqlBlock;
}

export interface Rule {
  id: string;
  scan(ctx: RuleContext): Finding[];
}

/**
 * Regex-based fallback rules. Used for `mysql` / `sqlite` dialects where the
 * Postgres AST parser would refuse most statements. Postgres goes through the
 * AST path instead (see `runRules`).
 */
export const legacyRules: Rule[] = [
  dropColumnRule,
  dropTableRule,
  renameColumnRule,
  addNotNullWithoutDefaultRule,
  createIndexNonConcurrentRule,
];

// Back-compat export (some tests / external callers still import `rules`).
export const rules = legacyRules;

export async function runRules(input: {
  sqlBlocks: SqlBlock[];
  ormStack: OrmStack;
  dialect: DatabaseDialect;
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const block of input.sqlBlocks) {
    if (input.dialect === "postgres") {
      const parsed = await parsePostgres({
        sql: block.sql,
        startLine: block.startLine,
      });
      if (parsed.error) {
        // libpg_query rejected the SQL — fall back to legacy regex rules on
        // this block so we still surface obvious destructive patterns instead
        // of going silent.
        findings.push(...runLegacy(input, block));
        continue;
      }
      findings.push(
        ...runAstRules({
          ormStack: input.ormStack,
          dialect: input.dialect,
          block,
          statements: parsed.statements,
        }),
      );
      continue;
    }
    findings.push(...runLegacy(input, block));
  }
  return findings;
}

function runLegacy(
  input: { ormStack: OrmStack; dialect: DatabaseDialect },
  block: SqlBlock,
): Finding[] {
  const out: Finding[] = [];
  for (const rule of legacyRules) {
    out.push(
      ...rule.scan({
        ormStack: input.ormStack,
        dialect: input.dialect,
        block,
      }),
    );
  }
  return out;
}
