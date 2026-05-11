import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSchemaSymbolIndex,
  expandSymbolsWithSchema,
} from "../src/impact/schema-symbols.js";

describe("schema symbol impact mapping", () => {
  it("maps Prisma @map/@@map database names to application field names", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mergebrake-prisma-"));
    await mkdir(path.join(repoRoot, "prisma"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "prisma", "schema.prisma"),
      `
model User {
  id Int @id
  displayName String @map("full_name")

  @@map("users")
}
`,
    );

    const index = await buildSchemaSymbolIndex({ repoRoot });
    const symbols = expandSymbolsWithSchema(index, ["users.full_name"]);

    expect(symbols).toContain("displayName");
    expect(symbols).toContain("User.displayName");
    expect(symbols).toContain("user.displayName");
  });

  it("maps Drizzle pgTable column names to exported table fields", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mergebrake-drizzle-"));
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "src", "schema.ts"),
      `
import { pgTable, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  displayName: text("full_name").notNull(),
});
`,
    );

    const index = await buildSchemaSymbolIndex({ repoRoot });
    const symbols = expandSymbolsWithSchema(index, ["users.full_name"]);

    expect(symbols).toContain("displayName");
    expect(symbols).toContain("users.displayName");
  });
});
