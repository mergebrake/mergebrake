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
});
