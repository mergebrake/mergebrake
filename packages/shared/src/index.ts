export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Verdict = "SAFE" | "EXPAND_CONTRACT" | "BLOCK";

export type OrmStack =
  | "prisma"
  | "drizzle"
  | "knex"
  | "sequelize"
  | "typeorm"
  | "raw-sql";

export type DatabaseDialect = "postgres" | "mysql" | "sqlite";

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

export interface CrossRef {
  file: string;
  line: number;
  snippet: string;
  symbol: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  location: SourceLocation;
  ormStack: OrmStack;
  dialect: DatabaseDialect;
  affectedSymbols: string[];
  crossRefs: CrossRef[];
  recipe?: ExpandContractRecipe;
  docsUrl?: string;
}

export interface ExpandContractRecipe {
  summary: string;
  steps: ExpandContractStep[];
}

export interface ExpandContractStep {
  phase: "expand" | "migrate-data" | "contract";
  description: string;
  sql?: string;
  appCodeNote?: string;
}

export interface AiPrSignals {
  hasCoAuthoredByAi: boolean;
  coAuthors: string[];
  isLikelyAiGenerated: boolean;
  reasons: string[];
  scrutinyMultiplier: number;
}

export interface AnalysisReport {
  verdict: Verdict;
  riskScore: number;
  findings: Finding[];
  aiPrSignals: AiPrSignals;
  ormStack: OrmStack;
  dialect: DatabaseDialect;
  scannedFiles: string[];
  durationMs: number;
}

export const VERDICT_THRESHOLDS = {
  blockAtRiskScore: 50,
  expandContractAtRiskScore: 15,
} as const;

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 50,
  high: 20,
  medium: 8,
  low: 3,
  info: 0,
};
