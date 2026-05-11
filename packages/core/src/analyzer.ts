import type {
  AnalysisReport,
  Finding,
  OrmStack,
  DatabaseDialect,
  AiPrSignals,
} from "@mergebrake/shared";
import { detectOrmStack } from "./parsers/orm-detector.js";
import { extractSqlFromOrm } from "./parsers/orm-sql-extractor.js";
import { runRules } from "./rules/index.js";
import { findCrossReferences } from "./crossref/code-grep.js";
import { detectAiPrSignals } from "./crossref/ai-pr-signals.js";
import { computeVerdict } from "./verdict.js";

export interface AnalyzerOptions {
  /** Absolute path to the repository root (used for cross-surface code grep). */
  repoRoot: string;
  /** Paths to migration files or directories. */
  inputs: string[];
  /** Optional commit metadata for AI-PR detection. */
  commitMessages?: string[];
  /** Optional explicit ORM stack override (auto-detected otherwise). */
  ormStack?: OrmStack;
  /** Optional explicit DB dialect override (auto-detected otherwise). */
  dialect?: DatabaseDialect;
  /** Disable cross-surface code grep (faster but loses key feature). */
  skipCrossRef?: boolean;
}

export async function analyzeMigration(
  opts: AnalyzerOptions,
): Promise<AnalysisReport> {
  const started = Date.now();

  const ormStack: OrmStack =
    opts.ormStack ?? (await detectOrmStack(opts.repoRoot));
  const dialect: DatabaseDialect = opts.dialect ?? "postgres";

  const aiPrSignals: AiPrSignals = detectAiPrSignals(opts.commitMessages ?? []);

  const sqlBlocks = await extractSqlFromOrm({
    ormStack,
    inputs: opts.inputs,
    repoRoot: opts.repoRoot,
  });

  const rawFindings = runRules({
    sqlBlocks,
    ormStack,
    dialect,
  });

  const findings: Finding[] = [];
  for (const f of rawFindings) {
    let crossRefs = f.crossRefs;
    if (!opts.skipCrossRef && f.affectedSymbols.length > 0) {
      crossRefs = await findCrossReferences({
        repoRoot: opts.repoRoot,
        symbols: f.affectedSymbols,
      });
    }
    findings.push({ ...f, crossRefs });
  }

  const { verdict, riskScore } = computeVerdict({
    findings,
    aiPrSignals,
  });

  return {
    verdict,
    riskScore,
    findings,
    aiPrSignals,
    ormStack,
    dialect,
    scannedFiles: sqlBlocks.map((b) => b.sourceFile),
    durationMs: Date.now() - started,
  };
}
