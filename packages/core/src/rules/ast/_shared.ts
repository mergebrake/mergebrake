import type { Finding, Severity } from "mergebrake-shared";
import type { SqlBlock } from "../../parsers/orm-sql-extractor.js";
import type { AstRuleContext } from "./index.js";

// Tables created via CREATE TABLE inside the same SqlBlock as the rule input.
// Locking rules on a freshly-created table (no rows yet, no concurrent writers)
// are theoretical noise; we cache the set per-block so each rule pays for the
// CREATE TABLE scan only once.
const FRESH_TABLES_CACHE = new WeakMap<SqlBlock, Set<string>>();

const CREATE_TABLE_RE =
  /\bCREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMPORARY\s+|TEMP\s+|UNLOGGED\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|[A-Za-z_]\w*)(?:\.(?:"[^"]+"|[A-Za-z_]\w*))?)/gi;

export function normalizeTableName(
  name: string | undefined | null,
): string {
  if (!name) return "";
  const last = name.split(".").pop() ?? "";
  return last.replace(/^"(.+)"$/, "$1").toLowerCase();
}

export function getFreshTablesInBlock(block: SqlBlock): Set<string> {
  const cached = FRESH_TABLES_CACHE.get(block);
  if (cached) return cached;
  const tables = new Set<string>();
  CREATE_TABLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CREATE_TABLE_RE.exec(block.sql)) !== null) {
    const t = normalizeTableName(m[1]);
    if (t) tables.add(t);
  }
  FRESH_TABLES_CACHE.set(block, tables);
  return tables;
}

export function isTableFreshInBlock(
  block: SqlBlock,
  tableName: string | undefined | null,
): boolean {
  if (!tableName) return false;
  return getFreshTablesInBlock(block).has(normalizeTableName(tableName));
}

export interface PartialFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  affectedSymbols: string[];
  recipe?: Finding["recipe"];
  docsUrl?: string;
}

export function makeFinding(
  ctx: AstRuleContext,
  partial: PartialFinding,
): Finding {
  return {
    ruleId: partial.ruleId,
    severity: partial.severity,
    title: partial.title,
    message: partial.message,
    location: {
      file: ctx.block.sourceFile,
      line: ctx.statement.startLine,
    },
    ormStack: ctx.ormStack,
    dialect: ctx.dialect,
    affectedSymbols: dedupe(partial.affectedSymbols),
    crossRefs: [],
    ...(partial.recipe ? { recipe: partial.recipe } : {}),
    ...(partial.docsUrl ? { docsUrl: partial.docsUrl } : {}),
  };
}

export function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter(Boolean)));
}
