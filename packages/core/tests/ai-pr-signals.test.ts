import { describe, expect, it } from "vitest";
import { detectAiPrSignals } from "../src/crossref/ai-pr-signals.js";

describe("detectAiPrSignals", () => {
  it("baseline x1.0 when no AI markers", () => {
    const s = detectAiPrSignals(["feat: add user table"]);
    expect(s.isLikelyAiGenerated).toBe(false);
    expect(s.scrutinyMultiplier).toBe(1);
  });

  it("detects Claude co-author", () => {
    const s = detectAiPrSignals([
      "feat: drop column\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
    ]);
    expect(s.hasCoAuthoredByAi).toBe(true);
    expect(s.coAuthors).toContain("Claude");
    expect(s.scrutinyMultiplier).toBeGreaterThanOrEqual(2.5);
  });

  it("detects Cursor", () => {
    const s = detectAiPrSignals(["Co-Authored-By: Cursor <noreply@cursor.sh>"]);
    expect(s.coAuthors).toContain("Cursor");
  });

  it("amplifies when multiple AI markers", () => {
    const s = detectAiPrSignals([
      "Co-Authored-By: Claude <noreply@anthropic.com>\n🤖 Generated with Claude Code",
    ]);
    expect(s.scrutinyMultiplier).toBeGreaterThanOrEqual(3);
  });
});
