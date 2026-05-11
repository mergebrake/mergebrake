import { describe, expect, it } from "vitest";
import { computeVerdict } from "../src/verdict.js";
import type { Finding, AiPrSignals } from "@mergebrake/shared";

const baseAi: AiPrSignals = {
  hasCoAuthoredByAi: false,
  coAuthors: [],
  isLikelyAiGenerated: false,
  reasons: [],
  scrutinyMultiplier: 1,
};

function f(sev: Finding["severity"]): Finding {
  return {
    ruleId: "test/x",
    severity: sev,
    title: "x",
    message: "x",
    location: { file: "x", line: 1 },
    ormStack: "raw-sql",
    dialect: "postgres",
    affectedSymbols: [],
    crossRefs: [],
  };
}

describe("computeVerdict", () => {
  it("SAFE when no findings", () => {
    const r = computeVerdict({ findings: [], aiPrSignals: baseAi });
    expect(r.verdict).toBe("SAFE");
  });
  it("BLOCK on a single critical", () => {
    const r = computeVerdict({ findings: [f("critical")], aiPrSignals: baseAi });
    expect(r.verdict).toBe("BLOCK");
  });
  it("EXPAND_CONTRACT on a single high", () => {
    const r = computeVerdict({ findings: [f("high")], aiPrSignals: baseAi });
    expect(r.verdict).toBe("EXPAND_CONTRACT");
  });
  it("AI multiplier pushes medium to BLOCK", () => {
    const ai: AiPrSignals = { ...baseAi, scrutinyMultiplier: 3 };
    const r = computeVerdict({ findings: [f("high"), f("high"), f("medium")], aiPrSignals: ai });
    // 25 + 25 + 10 = 60 * 3 = 180 -> BLOCK
    expect(r.riskScore).toBeGreaterThanOrEqual(70);
    expect(r.verdict).toBe("BLOCK");
  });
});
