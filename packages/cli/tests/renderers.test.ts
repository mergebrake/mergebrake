import { describe, expect, it } from "vitest";
import type { AnalysisReport, Finding } from "mergebrake-shared";
import { renderMarkdown } from "../src/renderers.js";

const baseReport: AnalysisReport = {
  verdict: "BLOCK",
  riskScore: 100,
  findings: [],
  aiPrSignals: {
    hasCoAuthoredByAi: false,
    coAuthors: [],
    isLikelyAiGenerated: false,
    reasons: [],
    scrutinyMultiplier: 1,
  },
  ormStack: "prisma",
  dialect: "postgres",
  scannedFiles: ["prisma/migrations/001/migration.sql"],
  durationMs: 12,
};

function finding(severity: Finding["severity"], idx: number): Finding {
  return {
    ruleId: `rule/${severity}-${idx}`,
    severity,
    title: `${severity} finding ${idx}`,
    message: `message ${idx}`,
    location: {
      file: `prisma/migrations/${String(idx).padStart(3, "0")}/migration.sql`,
      line: idx,
    },
    ormStack: "prisma",
    dialect: "postgres",
    affectedSymbols: [],
    crossRefs:
      idx === 2
        ? [{ file: "src/users.ts", line: 10, snippet: "user.fullName", symbol: "fullName" }]
        : [],
  };
}

describe("renderMarkdown", () => {
  it("keeps the PR comment focused by collapsing overflow and info findings", () => {
    const findings = [
      finding("critical", 1),
      ...Array.from({ length: 21 }, (_, i) => finding("high", i + 2)),
      finding("info", 100),
      finding("info", 101),
    ];

    const markdown = renderMarkdown({ ...baseReport, findings });

    expect(markdown).toContain("**Findings:** 1 critical, 21 high, 2 info");
    expect(markdown).toContain("Showing 20 actionable findings");
    expect(markdown).toContain("<strong>Additional actionable findings</strong> (2)");
    expect(markdown).toContain("<strong>Informational findings collapsed</strong> (2)");
    expect(markdown.match(/^### /gm)).toHaveLength(20);
  });

  it("emits GitHub annotations only for medium and above", () => {
    const findings = [
      finding("critical", 1),
      finding("high", 2),
      finding("medium", 3),
      finding("low", 4),
      finding("info", 5),
    ];

    const markdown = renderMarkdown({ ...baseReport, findings }, { githubAnnotations: true });
    const annotationLines = markdown.split("\n").filter((line) => line.startsWith("::"));

    expect(annotationLines).toHaveLength(3);
    expect(annotationLines.filter((line) => line.startsWith("::error"))).toHaveLength(2);
    expect(annotationLines.filter((line) => line.startsWith("::warning"))).toHaveLength(1);
    expect(annotationLines.some((line) => line.includes("low finding"))).toBe(false);
    expect(annotationLines.some((line) => line.includes("info finding"))).toBe(false);
  });
});
