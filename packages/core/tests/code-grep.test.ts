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

  it("ignores inline and block comments without hiding real code refs", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mergebrake-comments-"));
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "src", "users.ts"),
      `
// full_name should not count
const selected = user.fullName; // full_name should not count either
/*
full_name inside a block comment should not count
*/
const query = "SELECT full_name FROM users";
`,
    );

    const refs = await findCrossReferences({
      repoRoot,
      symbols: ["full_name", "fullName"],
    });

    expect(refs.map((ref) => ref.line).sort((a, b) => a - b)).toEqual([3, 7]);
    expect(refs.map((ref) => ref.snippet)).not.toContain(
      "full_name inside a block comment should not count",
    );
  });
});
