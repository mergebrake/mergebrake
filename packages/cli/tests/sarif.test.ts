import { describe, expect, it } from "vitest";
import { renderSarif } from "../src/sarif.js";
import type { AnalysisReport } from "mergebrake-shared";

const baseReport: AnalysisReport = {
  verdict: "BLOCK",
  riskScore: 150,
  findings: [
    {
      ruleId: "destructive/drop-column",
      severity: "critical",
      title: "DROP COLUMN users.full_name is destructive",
      message: "This migration drops column full_name from users.",
      location: { file: "prisma\\migrations\\x\\migration.sql", line: 3 },
      ormStack: "prisma",
      dialect: "postgres",
      affectedSymbols: ["full_name", "fullName", "users.full_name"],
      crossRefs: [],
      docsUrl: "https://mergebrake.dev/rules/destructive/drop-column",
    },
    {
      ruleId: "locking/create-index-non-concurrent",
      severity: "medium",
      title: "CREATE INDEX i on users blocks writes",
      message: "Use CONCURRENTLY.",
      location: { file: "prisma/migrations/x/migration.sql", line: 8 },
      ormStack: "prisma",
      dialect: "postgres",
      affectedSymbols: ["i", "users"],
      crossRefs: [],
    },
  ],
  aiPrSignals: {
    hasCoAuthoredByAi: false,
    coAuthors: [],
    isLikelyAiGenerated: false,
    reasons: [],
    scrutinyMultiplier: 1,
  },
  ormStack: "prisma",
  dialect: "postgres",
  scannedFiles: ["prisma/migrations/x/migration.sql"],
  durationMs: 12,
};

describe("renderSarif", () => {
  const json = JSON.parse(renderSarif(baseReport));

  it("emits SARIF 2.1.0 envelope", () => {
    expect(json.version).toBe("2.1.0");
    expect(json.$schema).toContain("sarif-schema-2.1.0");
    expect(json.runs).toHaveLength(1);
  });

  it("registers each unique rule once with default severity level", () => {
    const rules = json.runs[0].tool.driver.rules;
    expect(rules.map((r: { id: string }) => r.id)).toEqual([
      "destructive/drop-column",
      "locking/create-index-non-concurrent",
    ]);
    const drop = rules.find(
      (r: { id: string }) => r.id === "destructive/drop-column",
    );
    expect(drop.defaultConfiguration.level).toBe("error");
    expect(drop.name).toBe("DropColumn");
    expect(drop.helpUri).toContain("mergebrake.dev/rules");
  });

  it("emits one result per finding with normalised forward-slash URIs", () => {
    const results = json.runs[0].results;
    expect(results).toHaveLength(2);
    const drop = results[0];
    expect(drop.ruleId).toBe("destructive/drop-column");
    expect(drop.level).toBe("error");
    expect(drop.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "prisma/migrations/x/migration.sql",
    );
    expect(drop.locations[0].physicalLocation.region.startLine).toBe(3);
    expect(drop.partialFingerprints["mergebrake/v1"]).toContain(
      "destructive/drop-column",
    );
  });

  it("maps medium severity to warning", () => {
    const idx = json.runs[0].results.find(
      (r: { ruleId: string }) =>
        r.ruleId === "locking/create-index-non-concurrent",
    );
    expect(idx.level).toBe("warning");
  });

  it("never emits a startLine of zero", () => {
    const tweaked = renderSarif({
      ...baseReport,
      findings: [
        {
          ...baseReport.findings[0]!,
          location: { file: "x.sql", line: 0 },
        },
      ],
    });
    const parsed = JSON.parse(tweaked);
    expect(
      parsed.runs[0].results[0].locations[0].physicalLocation.region.startLine,
    ).toBe(1);
  });
});
