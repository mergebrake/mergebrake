import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findCrossReferences } from "../src/crossref/code-grep.js";

describe("findCrossReferences", () => {
  it("scans raw SQL query files but ignores migration files and duplicate symbol hits", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mergebrake-refs-"));
    await mkdir(path.join(repoRoot, "queries"), { recursive: true });
    await mkdir(path.join(repoRoot, "prisma", "migrations", "001"), {
      recursive: true,
    });
    await writeFile(
      path.join(repoRoot, "queries", "users.sql"),
      `SELECT "users"."full_name" FROM "users";\n`,
    );
    await writeFile(
      path.join(repoRoot, "prisma", "migrations", "001", "migration.sql"),
      `ALTER TABLE users DROP COLUMN full_name;\n`,
    );

    const refs = await findCrossReferences({
      repoRoot,
      symbols: ["full_name", "users.full_name"],
    });

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      file: "queries/users.sql",
      line: 1,
    });
  });
});
