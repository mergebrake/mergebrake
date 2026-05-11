import { describe, expect, it } from "vitest";
import { filterChangedInputs } from "../src/changed-inputs.js";

describe("filterChangedInputs", () => {
  it("keeps only changed files matching migration globs", () => {
    const changed = [
      "prisma/migrations/20260511_drop/migration.sql",
      "src/api/users.ts",
      "README.md",
      "drizzle/0001_init.sql",
    ];

    expect(
      filterChangedInputs(changed, [
        "prisma/migrations/**/migration.sql",
        "drizzle/**/*.sql",
      ]),
    ).toEqual([
      "prisma/migrations/20260511_drop/migration.sql",
      "drizzle/0001_init.sql",
    ]);
  });

  it("supports directory inputs and brace globs", () => {
    const changed = [
      "db/migrate/001_add_user.sql",
      "db/migrate/002_add_user.ts",
      "db/seeds/users.sql",
      "lib/query.sql",
    ];

    expect(filterChangedInputs(changed, ["db/migrate"])).toEqual([
      "db/migrate/001_add_user.sql",
      "db/migrate/002_add_user.ts",
    ]);
    expect(filterChangedInputs(changed, ["**/*.{sql,ts}"])).toEqual(changed);
  });

  it("returns an empty list when a PR changes app code but no migration", () => {
    expect(
      filterChangedInputs(
        ["src/api/users.ts", "app/profile/page.tsx"],
        ["prisma/migrations/**/migration.sql"],
      ),
    ).toEqual([]);
  });
});
