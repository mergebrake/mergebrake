import { describe, expect, it } from "vitest";
import { runRules } from "../src/rules/index.js";
import type { SqlBlock } from "../src/parsers/orm-sql-extractor.js";

async function scan(sql: string) {
  const block: SqlBlock = {
    sourceFile: "test.sql",
    ormStack: "raw-sql",
    sql,
    startLine: 1,
  };
  return runRules({
    sqlBlocks: [block],
    ormStack: "raw-sql",
    dialect: "postgres",
  });
}

describe("destructive/drop-index", () => {
  it("flags DROP INDEX", async () => {
    const findings = await scan(`DROP INDEX users_email_idx;`);
    const f = findings.find((x) => x.ruleId === "destructive/drop-index");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.affectedSymbols).toContain("users_email_idx");
  });

  it("flags CONCURRENTLY drops too (but the message notes the lock difference)", async () => {
    const findings = await scan(
      `DROP INDEX CONCURRENTLY IF EXISTS public.users_email_idx;`,
    );
    const f = findings.find((x) => x.ruleId === "destructive/drop-index");
    expect(f).toBeDefined();
    expect(f!.title).toMatch(/CONCURRENTLY/);
    expect(f!.affectedSymbols).toContain("public.users_email_idx");
  });

  it("handles a single DROP INDEX that names multiple indexes", async () => {
    const findings = await scan(`DROP INDEX a_idx, b_idx;`);
    const drops = findings.filter((x) => x.ruleId === "destructive/drop-index");
    expect(drops).toHaveLength(2);
    expect(drops.map((f) => f.affectedSymbols[0]).sort()).toEqual([
      "a_idx",
      "b_idx",
    ]);
  });
});

describe("destructive/drop-constraint", () => {
  it("flags DROP CONSTRAINT on table", async () => {
    const findings = await scan(
      `ALTER TABLE users DROP CONSTRAINT users_email_uniq;`,
    );
    const f = findings.find((x) => x.ruleId === "destructive/drop-constraint");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
    expect(f!.affectedSymbols).toContain("users_email_uniq");
    expect(f!.affectedSymbols).toContain("users");
  });
});

describe("safety/drop-not-null", () => {
  it("flags DROP NOT NULL", async () => {
    const findings = await scan(
      `ALTER TABLE users ALTER COLUMN email DROP NOT NULL;`,
    );
    const f = findings.find((x) => x.ruleId === "safety/drop-not-null");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
  });

  it("does not fire on SET NOT NULL (different rule owns that)", async () => {
    const findings = await scan(
      `ALTER TABLE users ALTER COLUMN email SET NOT NULL;`,
    );
    expect(
      findings.find((x) => x.ruleId === "safety/drop-not-null"),
    ).toBeUndefined();
  });
});

describe("safety/drop-default", () => {
  it("flags DROP DEFAULT via AT_ColumnDefault with no def", async () => {
    const findings = await scan(
      `ALTER TABLE users ALTER COLUMN email DROP DEFAULT;`,
    );
    const f = findings.find((x) => x.ruleId === "safety/drop-default");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("low");
  });

  it("does not fire on SET DEFAULT", async () => {
    const findings = await scan(
      `ALTER TABLE users ALTER COLUMN email SET DEFAULT 'unknown';`,
    );
    expect(
      findings.find((x) => x.ruleId === "safety/drop-default"),
    ).toBeUndefined();
  });
});

describe("safety/create-table-without-primary-key", () => {
  it("flags a table without any PK", async () => {
    const findings = await scan(`CREATE TABLE logs (msg text, lvl int);`);
    const f = findings.find(
      (x) => x.ruleId === "safety/create-table-without-primary-key",
    );
    expect(f).toBeDefined();
  });

  it("does not flag inline PRIMARY KEY", async () => {
    const findings = await scan(
      `CREATE TABLE good (id bigserial PRIMARY KEY, msg text);`,
    );
    expect(
      findings.find(
        (x) => x.ruleId === "safety/create-table-without-primary-key",
      ),
    ).toBeUndefined();
  });

  it("does not flag table-level PRIMARY KEY constraint (composite)", async () => {
    const findings = await scan(
      `CREATE TABLE composite (user_id int, org_id int, PRIMARY KEY (user_id, org_id));`,
    );
    expect(
      findings.find(
        (x) => x.ruleId === "safety/create-table-without-primary-key",
      ),
    ).toBeUndefined();
  });
});

describe("locking/add-column-with-volatile-default", () => {
  it("does not flag ADD COLUMN ... DEFAULT now() as a table rewrite", async () => {
    const findings = await scan(
      `ALTER TABLE users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();`,
    );
    expect(
      findings.find(
        (x) => x.ruleId === "locking/add-column-with-volatile-default",
      ),
    ).toBeUndefined();
    expect(
      findings.find((x) => x.ruleId === "safety/set-default-volatile"),
    ).toBeDefined();
  });

  it("flags ADD COLUMN ... DEFAULT gen_random_uuid()", async () => {
    const findings = await scan(
      `ALTER TABLE users ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();`,
    );
    const f = findings.find(
      (x) => x.ruleId === "locking/add-column-with-volatile-default",
    );
    expect(f).toBeDefined();
    const recipeSql = f!.recipe?.steps[1]?.sql ?? "";
    expect(recipeSql).toContain("ctid");
    expect(recipeSql).not.toMatch(/id IN/);
  });

  it("does not flag ADD COLUMN with a constant default", async () => {
    const findings = await scan(
      `ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT false;`,
    );
    expect(
      findings.find(
        (x) => x.ruleId === "locking/add-column-with-volatile-default",
      ),
    ).toBeUndefined();
  });
});
