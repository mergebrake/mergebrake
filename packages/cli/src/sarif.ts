import type { AnalysisReport, Finding, Severity } from "mergebrake-shared";
import { MERGEBRAKE_VERSION } from "./version.js";

/**
 * SARIF 2.1.0 envelope produced by `mergebrake scan --format sarif`.
 *
 * The output is small on purpose: we expose `tool.driver.rules[]` so GitHub
 * Code Scanning shows nice rule titles and help URLs, plus `results[]` with
 * physical locations and severity. Anything beyond that (regions, fingerprints,
 * code flows) is intentionally omitted for V0.
 */
export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

export interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
}

export interface SarifDriver {
  name: string;
  version: string;
  informationUri: string;
  rules: SarifRule[];
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
  defaultConfiguration?: { level: SarifLevel };
}

export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  properties?: { severity: Severity; risk?: number };
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number };
  };
}

export type SarifLevel = "error" | "warning" | "note" | "none";

const SEVERITY_TO_LEVEL: Record<Severity, SarifLevel> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "note",
};

const TOOL_NAME = "MergeBrake";
const TOOL_URI = "https://mergebrake.dev";

export function renderSarif(report: AnalysisReport): string {
  const rules = collectRules(report.findings);
  const results = report.findings.map(findingToResult);
  const log: SarifLog = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: MERGEBRAKE_VERSION,
            informationUri: TOOL_URI,
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(log, null, 2) + "\n";
}

function collectRules(findings: Finding[]): SarifRule[] {
  const map = new Map<string, SarifRule>();
  for (const f of findings) {
    if (map.has(f.ruleId)) continue;
    const rule: SarifRule = {
      id: f.ruleId,
      name: toRuleName(f.ruleId),
      shortDescription: { text: f.title.slice(0, 200) },
      fullDescription: { text: f.message.slice(0, 1000) },
      defaultConfiguration: { level: SEVERITY_TO_LEVEL[f.severity] },
    };
    if (f.docsUrl) rule.helpUri = f.docsUrl;
    map.set(f.ruleId, rule);
  }
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function findingToResult(f: Finding): SarifResult {
  const result: SarifResult = {
    ruleId: f.ruleId,
    level: SEVERITY_TO_LEVEL[f.severity],
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: toSarifUri(f.location.file) },
          region: { startLine: Math.max(1, f.location.line) },
        },
      },
    ],
    partialFingerprints: {
      "mergebrake/v1": `${f.ruleId}|${toSarifUri(f.location.file)}|${f.location.line}|${(f.affectedSymbols ?? []).join(",")}`,
    },
    properties: { severity: f.severity },
  };
  return result;
}

/**
 * Convert a "namespace/rule-id" into a PascalCase name. SARIF doesn't require
 * this, but most consumers (GitHub Code Scanning included) render `name`
 * nicely when it's a single token.
 */
function toRuleName(ruleId: string): string {
  const tail = ruleId.split("/").slice(-1)[0] ?? ruleId;
  return tail
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function toSarifUri(file: string): string {
  // SARIF expects forward-slash relative paths.
  return file.replace(/\\/g, "/").replace(/^\.\/+/, "");
}
