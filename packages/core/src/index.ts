export { analyzeMigration } from "./analyzer.js";
export { detectOrmStack } from "./parsers/orm-detector.js";
export { extractSqlFromOrm } from "./parsers/orm-sql-extractor.js";
export { detectAiPrSignals } from "./crossref/ai-pr-signals.js";
export { findCrossReferences } from "./crossref/code-grep.js";
export { rules } from "./rules/index.js";
export { computeVerdict } from "./verdict.js";
export type { AnalyzerOptions } from "./analyzer.js";
