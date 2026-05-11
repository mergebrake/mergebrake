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
import {
  buildSchemaSymbolIndex,
  expandSymbolsWithSchema,
} from "./impact/schema-symbols.js";
import { applyConfig } from "./config/apply.js";
import type { MergeBrakeConfig } from "./config/types.js";

export interface AnalyzerOptions {
  /** Absolute path to the repository root (used for cross-surface code grep). */
  repoRoot: string;
  /** Optional checkout of the base branch for deploy-order impact checks. */
  baseRepoRoot?: string;
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
  /**
   * Optional MergeBrake configuration to apply post-rules. Pass the parsed
   * object from `loadConfig`; the analyzer takes care of filtering findings
   * and applying severity overrides before the verdict is computed.
   */
  config?: MergeBrakeConfig;
}

export async function analyzeMigration(
  opts: AnalyzerOptions,
): Promise<AnalysisReport> {
  const started = Date.now();

  const ormStack: OrmStack =
    opts.ormStack ?? (await detectOrmStack(opts.repoRoot));
  const dialect: DatabaseDialect = opts.dialect ?? "postgres";

  const aiPrSignals: AiPrSignals = detectAiPrSignals(opts.commitMessages ?? []);
  const schemaSymbolOpts: { repoRoot: string; baseRepoRoot?: string } = {
    repoRoot: opts.repoRoot,
  };
  if (opts.baseRepoRoot) {
    schemaSymbolOpts.baseRepoRoot = opts.baseRepoRoot;
  }
  const schemaSymbolIndex = await buildSchemaSymbolIndex(schemaSymbolOpts);

  const sqlBlocks = await extractSqlFromOrm({
    ormStack,
    inputs: opts.inputs,
    repoRoot: opts.repoRoot,
  });

  const rawFindings = await runRules({
    sqlBlocks,
    ormStack,
    dialect,
  });

  const findings: Finding[] = [];
  for (const f of rawFindings) {
    const affectedSymbols = expandSymbolsWithSchema(
      schemaSymbolIndex,
      f.affectedSymbols,
    );
    let crossRefs = f.crossRefs;
    if (!opts.skipCrossRef && affectedSymbols.length > 0) {
      crossRefs = await findCrossReferences(crossRefOptions({
        repoRoot: opts.repoRoot,
        symbols: affectedSymbols,
        config: opts.config,
      }));
    }
    const finding = { ...f, affectedSymbols, crossRefs };
    findings.push(finding);

    if (
      opts.baseRepoRoot &&
      !opts.skipCrossRef &&
      isContractFinding(finding) &&
      finding.crossRefs.length === 0
    ) {
      const baseCrossRefs = await findCrossReferences(crossRefOptions({
        repoRoot: opts.baseRepoRoot,
        symbols: affectedSymbols,
        config: opts.config,
      }));
      if (baseCrossRefs.length > 0) {
        findings.push(buildContractWithoutExpandFinding(finding, baseCrossRefs));
      }
    }
  }

  const filteredFindings = opts.config
    ? applyConfig({ findings, config: opts.config })
    : findings;

  const { verdict, riskScore } = computeVerdict({
    findings: filteredFindings,
    aiPrSignals,
  });

  return {
    verdict,
    riskScore,
    findings: filteredFindings,
    aiPrSignals,
    ormStack,
    dialect,
    scannedFiles: sqlBlocks.map((b) => b.sourceFile),
    durationMs: Date.now() - started,
  };
}

function crossRefOptions(input: {
  repoRoot: string;
  symbols: string[];
  config: MergeBrakeConfig | undefined;
}): Parameters<typeof findCrossReferences>[0] {
  const out: Parameters<typeof findCrossReferences>[0] = {
    repoRoot: input.repoRoot,
    symbols: input.symbols,
  };
  if (input.config?.crossRef?.globs) {
    out.globs = input.config.crossRef.globs;
  }
  if (input.config?.crossRef?.maxMatchesPerSymbol !== undefined) {
    out.maxMatchesPerSymbol = input.config.crossRef.maxMatchesPerSymbol;
  }
  return out;
}

function isContractFinding(finding: Finding): boolean {
  return (
    finding.ruleId === "destructive/drop-column" ||
    finding.ruleId === "destructive/drop-table" ||
    finding.ruleId === "destructive/rename-column"
  );
}

function buildContractWithoutExpandFinding(
  finding: Finding,
  baseCrossRefs: Finding["crossRefs"],
): Finding {
  const markedBaseRefs = baseCrossRefs.map((ref) => ({
    ...ref,
    file: `base:${ref.file}`,
  }));
  return {
    ruleId: "deploy-order/contract-without-expand",
    severity: "high",
    title: "Contract migration appears bundled with app cleanup",
    message:
      `The current checkout no longer references the affected symbol, but the base branch still does. ` +
      `That usually means this PR removes application reads/writes and runs the destructive contract migration in the same deploy. ` +
      `Old app instances can still reference the column while the migration has already dropped it. Split this into an expand PR first, then a later contract PR.`,
    location: finding.location,
    ormStack: finding.ormStack,
    dialect: finding.dialect,
    affectedSymbols: finding.affectedSymbols,
    crossRefs: markedBaseRefs,
    recipe: {
      summary:
        "Split this PR into two deploys: app cleanup first, destructive schema cleanup later.",
      steps: [
        {
          phase: "expand",
          description:
            "Merge and deploy the app-code cleanup while keeping the old schema available.",
          appCodeNote:
            "Use the base-branch references listed below as the checklist for code paths that must stop reading or writing the old symbol.",
        },
        {
          phase: "contract",
          description:
            "After the app cleanup has been live for at least one release cycle, run the destructive migration in a follow-up PR.",
        },
      ],
    },
  };
}
