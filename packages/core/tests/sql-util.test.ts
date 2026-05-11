import { describe, expect, it } from "vitest";
import {
  splitStatements,
  matchAlterTableDropColumn,
  matchDropTable,
  matchRenameColumn,
  matchAddColumnNotNullNoDefault,
  matchCreateIndexNonConcurrent,
  stripComments,
} from "../src/rules/sql-util.js";

describe("splitStatements", () => {
  it("splits on terminating semicolons followed by newlines", () => {
    const stmts = splitStatements(
      `ALTER TABLE users DROP COLUMN x;\nCREATE INDEX i ON users(x);\n`,
    );
    expect(stmts).toHaveLength(2);
    expect(stmts[0]!.text.startsWith("ALTER")).toBe(true);
    expect(stmts[1]!.text.startsWith("CREATE")).toBe(true);
  });

  it("preserves the last statement without trailing newline", () => {
    const stmts = splitStatements(`DROP TABLE users`);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]!.text).toBe("DROP TABLE users");
  });

  it("splits semicolon-separated statements on the same line", () => {
    const stmts = splitStatements(
      `ALTER TABLE users DROP COLUMN x; CREATE INDEX i ON users(email);`,
    );
    expect(stmts).toHaveLength(2);
    expect(stmts[0]!.startLine).toBe(1);
    expect(stmts[1]!.startLine).toBe(1);
  });

  it("does not split semicolons inside strings or function bodies", () => {
    const stmts = splitStatements(
      `SELECT ';';\nDO $$ BEGIN RAISE NOTICE ';'; END $$;\nDROP TABLE users;`,
    );
    expect(stmts).toHaveLength(3);
    expect(stmts[2]!.text).toBe("DROP TABLE users");
    expect(stmts[2]!.startLine).toBe(3);
  });

  it("strips line comments", () => {
    const stmts = splitStatements(
      `-- this is a comment\nALTER TABLE users DROP COLUMN x;`,
    );
    expect(stmts).toHaveLength(1);
    expect(stmts[0]!.text.startsWith("ALTER")).toBe(true);
    expect(stmts[0]!.startLine).toBe(2);
  });
});

describe("stripComments", () => {
  it("removes block comments", () => {
    expect(stripComments("/* nope */ SELECT 1")).toContain("SELECT 1");
    expect(stripComments("/* nope */ SELECT 1")).not.toContain("nope");
  });
  it("removes line comments", () => {
    expect(stripComments("SELECT 1 -- nope")).not.toContain("nope");
  });
});

describe("matchAlterTableDropColumn", () => {
  it("matches quoted identifiers", () => {
    const m = matchAlterTableDropColumn(
      `ALTER TABLE "users" DROP COLUMN "full_name"`,
    );
    expect(m).toHaveLength(1);
    expect(m[0]).toEqual({
      table: "users",
      column: "full_name",
      ifExists: false,
    });
  });

  it("matches unquoted identifiers", () => {
    const m = matchAlterTableDropColumn(
      `ALTER TABLE users DROP COLUMN full_name`,
    );
    expect(m[0]).toEqual({
      table: "users",
      column: "full_name",
      ifExists: false,
    });
  });

  it("matches IF EXISTS variants", () => {
    const m = matchAlterTableDropColumn(
      `ALTER TABLE IF EXISTS users DROP COLUMN IF EXISTS full_name`,
    );
    expect(m[0]?.ifExists).toBe(true);
  });

  it("matches schema-qualified table names", () => {
    const m = matchAlterTableDropColumn(
      `ALTER TABLE "public"."users" DROP COLUMN "full_name"`,
    );
    expect(m[0]?.table).toBe("public.users");
  });

  it("does not match RENAME", () => {
    const m = matchAlterTableDropColumn(
      `ALTER TABLE users RENAME COLUMN x TO y`,
    );
    expect(m).toHaveLength(0);
  });
});

describe("matchDropTable", () => {
  it("flags CASCADE", () => {
    const m = matchDropTable(`DROP TABLE users CASCADE`);
    expect(m[0]).toMatchObject({ table: "users", cascade: true });
  });
  it("flags IF EXISTS", () => {
    const m = matchDropTable(`DROP TABLE IF EXISTS "old_data"`);
    expect(m[0]).toMatchObject({ table: "old_data", ifExists: true });
  });
});

describe("matchRenameColumn", () => {
  it("captures from and to names", () => {
    const m = matchRenameColumn(
      `ALTER TABLE "users" RENAME COLUMN "name" TO "full_name"`,
    );
    expect(m[0]).toEqual({
      table: "users",
      fromColumn: "name",
      toColumn: "full_name",
    });
  });
});

describe("matchAddColumnNotNullNoDefault", () => {
  it("flags NOT NULL without DEFAULT", () => {
    const m = matchAddColumnNotNullNoDefault(
      `ALTER TABLE users ADD COLUMN org_id INTEGER NOT NULL`,
    );
    expect(m[0]).toEqual({ table: "users", column: "org_id" });
  });
  it("does not flag NOT NULL with DEFAULT", () => {
    const m = matchAddColumnNotNullNoDefault(
      `ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT false`,
    );
    expect(m).toHaveLength(0);
  });
  it("does not flag nullable columns", () => {
    const m = matchAddColumnNotNullNoDefault(
      `ALTER TABLE users ADD COLUMN bio text`,
    );
    expect(m).toHaveLength(0);
  });
});

describe("matchCreateIndexNonConcurrent", () => {
  it("flags missing CONCURRENTLY", () => {
    const m = matchCreateIndexNonConcurrent(
      `CREATE INDEX users_email_idx ON users (email)`,
    );
    expect(m[0]).toEqual({ table: "users", index: "users_email_idx" });
  });
  it("does not flag CONCURRENTLY", () => {
    const m = matchCreateIndexNonConcurrent(
      `CREATE INDEX CONCURRENTLY users_email_idx ON users (email)`,
    );
    expect(m).toHaveLength(0);
  });
  it("flags UNIQUE INDEX without CONCURRENTLY", () => {
    const m = matchCreateIndexNonConcurrent(
      `CREATE UNIQUE INDEX i ON t (x)`,
    );
    expect(m).toHaveLength(1);
  });
});
