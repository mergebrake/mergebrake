import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMigration } from "../src/analyzer.js";

describe("analyzeMigration", () => {
  it("reports migration and cross-reference paths relative to the repo root", async () => {
    const repoRoot = fileURLToPath(
      new URL("../../../examples/prisma-drop-column/", import.meta.url),
    );

    const report = await analyzeMigration({
      repoRoot,
      inputs: ["prisma/migrations/**/migration.sql"],
      commitMessages: [
        "drop full_name\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>",
      ],
    });

    expect(report.verdict).toBe("BLOCK");
    expect(report.scannedFiles).toEqual([
      "prisma/migrations/20260511_drop_full_name/migration.sql",
    ]);

    const finding = report.findings[0]!;
    expect(path.isAbsolute(finding.location.file)).toBe(false);
    expect(finding.location.file).toBe(
      "prisma/migrations/20260511_drop_full_name/migration.sql",
    );
    expect(finding.crossRefs.map((ref) => ref.file)).toContain(
      "src/api/users.ts",
    );
    expect(finding.crossRefs.map((ref) => ref.snippet)).not.toContain(
      "// Raw query that still mentions full_name",
    );
  });

  it("detects contract-without-expand when the base branch still had app refs", async () => {
    const headRoot = fileURLToPath(
      new URL(
        "./fixtures/contract-without-expand/head/",
        import.meta.url,
      ),
    );
    const baseRoot = fileURLToPath(
      new URL(
        "./fixtures/contract-without-expand/base/",
        import.meta.url,
      ),
    );

    const report = await analyzeMigration({
      repoRoot: headRoot,
      baseRepoRoot: baseRoot,
      inputs: ["prisma/migrations/**/migration.sql"],
    });

    expect(report.findings.map((finding) => finding.ruleId)).toContain(
      "deploy-order/contract-without-expand",
    );
    const deployOrderFinding = report.findings.find(
      (finding) => finding.ruleId === "deploy-order/contract-without-expand",
    )!;
    expect(deployOrderFinding.crossRefs[0]?.file).toBe("base:src/api/users.ts");
    expect(deployOrderFinding.crossRefs[0]?.symbol).toBe("displayName");
  });
});
