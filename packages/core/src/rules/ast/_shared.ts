import type { Finding, Severity } from "mergebrake-shared";
import type { AstRuleContext } from "./index.js";

export function normalizeTableName(
  name: string | undefined | null,
): string {
  if (!name) return "";
  const last = name.split(".").pop() ?? "";
  return last.replace(/^"(.+)"$/, "$1").toLowerCase();
}

export function isTableFreshInBlock(
  ctx: AstRuleContext,
  tableName: string | undefined | null,
): boolean {
  if (!tableName) return false;
  return ctx.freshTables.has(normalizeTableName(tableName));
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
