import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
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

  it("applies cross-ref globs from config", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mergebrake-crossref-"));
    await mkdir(path.join(repoRoot, "prisma", "migrations", "001"), {
      recursive: true,
    });
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "ignored"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "prisma", "migrations", "001", "migration.sql"),
      "ALTER TABLE users DROP COLUMN full_name;",
    );
    await writeFile(
      path.join(repoRoot, "src", "users.ts"),
      "const x = user.fullName;",
    );
    await writeFile(
      path.join(repoRoot, "ignored", "users.ts"),
      "const x = user.fullName;",
    );

    const report = await analyzeMigration({
      repoRoot,
      inputs: ["prisma/migrations/**/migration.sql"],
      config: { crossRef: { globs: ["src/**/*.ts"] } },
    });

    expect(report.findings[0]?.crossRefs.map((ref) => ref.file)).toEqual([
      "src/users.ts",
    ]);
  });
});
