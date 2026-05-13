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

describe("AST rule engine — Postgres dialect", () => {
  describe("destructive/drop-column", () => {
    it("flags ALTER TABLE ... DROP COLUMN", async () => {
      const findings = await scan(`ALTER TABLE users DROP COLUMN full_name;`);
      const f = findings.find((x) => x.ruleId === "destructive/drop-column");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("critical");
      expect(f!.affectedSymbols).toContain("full_name");
      expect(f!.affectedSymbols).toContain("fullName");
      expect(f!.affectedSymbols).toContain("users.full_name");
    });

    it("captures schema-qualified table names", async () => {
      const findings = await scan(`ALTER TABLE "public"."users" DROP COLUMN "x";`);
      const f = findings.find((x) => x.ruleId === "destructive/drop-column");
      expect(f).toBeDefined();
      expect(f!.affectedSymbols).toContain("public.users.x");
    });
  });

  describe("destructive/drop-table", () => {
    it("flags DROP TABLE with CASCADE", async () => {
      const findings = await scan(`DROP TABLE users CASCADE;`);
      const f = findings.find((x) => x.ruleId === "destructive/drop-table");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("critical");
      expect(f!.title).toMatch(/CASCADE/);
    });
  });

  describe("destructive/rename-column", () => {
    it("only fires on COLUMN renames", async () => {
      const findings = await scan(
        `ALTER TABLE users RENAME COLUMN name TO full_name;\n` +
          `ALTER TABLE users RENAME TO accounts;`,
      );
      const renames = findings.filter(
        (x) => x.ruleId === "destructive/rename-column",
      );
      expect(renames).toHaveLength(1);
      expect(renames[0]!.affectedSymbols).toContain("name");
    });
  });

  describe("locking/add-not-null-without-default", () => {
    it("flags NOT NULL without DEFAULT", async () => {
      const findings = await scan(
        `ALTER TABLE users ADD COLUMN org_id integer NOT NULL;`,
      );
      const f = findings.find(
        (x) => x.ruleId === "locking/add-not-null-without-default",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("high");
    });

    it("does not fire when DEFAULT is provided", async () => {
      const findings = await scan(
        `ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT false;`,
      );
      expect(
        findings.find((x) => x.ruleId === "locking/add-not-null-without-default"),
      ).toBeUndefined();
    });
  });

  describe("locking/create-index-non-concurrent", () => {
    it("flags non-concurrent index", async () => {
      const findings = await scan(`CREATE INDEX users_email_idx ON users(email);`);
      const f = findings.find(
        (x) => x.ruleId === "locking/create-index-non-concurrent",
      );
      expect(f).toBeDefined();
    });

    it("escalates unique index severity to high", async () => {
      const findings = await scan(`CREATE UNIQUE INDEX i ON t(x);`);
      const f = findings.find(
        (x) => x.ruleId === "locking/create-index-non-concurrent",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("high");
    });

    it("ignores CONCURRENTLY", async () => {
      const findings = await scan(
        `CREATE INDEX CONCURRENTLY users_email_idx ON users(email);`,
      );
      expect(
        findings.find((x) => x.ruleId === "locking/create-index-non-concurrent"),
      ).toBeUndefined();
    });
  });

  describe("fresh-table demotion (initial-migration noise)", () => {
    it("demotes CREATE INDEX to info when the table is created in the same block", async () => {
      const findings = await scan(
        `CREATE TABLE "Account" ("id" text PRIMARY KEY, "providerId" text NOT NULL);\n` +
          `CREATE UNIQUE INDEX "Account_providerId_key" ON "Account"("providerId");`,
      );
      const f = findings.find(
        (x) => x.ruleId === "locking/create-index-non-concurrent",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("info");
      expect(f!.title).toMatch(/fresh table/i);
    });

    it("still flags CREATE INDEX as high/medium on a pre-existing table", async () => {
      const findings = await scan(
        `CREATE UNIQUE INDEX "Account_providerId_key" ON "Account"("providerId");`,
      );
      const f = findings.find(
        (x) => x.ruleId === "locking/create-index-non-concurrent",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("high");
    });

    it("demotes ADD FK to info when the constrained table is freshly created", async () => {
      const findings = await scan(
        `CREATE TABLE "Account" ("id" text PRIMARY KEY, "userId" text NOT NULL);\n` +
          `ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" ` +
          `FOREIGN KEY ("userId") REFERENCES "User"("id");`,
      );
      const f = findings.find(
        (x) => x.ruleId === "locking/add-foreign-key-without-not-valid",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("info");
    });

    it("still flags ADD FK as high on a pre-existing table", async () => {
      const findings = await scan(
        `ALTER TABLE "orders" ADD CONSTRAINT "fk_user" ` +
          `FOREIGN KEY ("user_id") REFERENCES "users"("id");`,
      );
      const f = findings.find(
        (x) => x.ruleId === "locking/add-foreign-key-without-not-valid",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("high");
    });

    it("handles schema-qualified CREATE TABLE", async () => {
      const findings = await scan(
        `CREATE TABLE "public"."Session" ("id" text PRIMARY KEY);\n` +
          `CREATE UNIQUE INDEX "Session_id_key" ON "Session"("id");`,
      );
      const f = findings.find(
        (x) => x.ruleId === "locking/create-index-non-concurrent",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("info");
    });

    it("does not demote when CREATE TABLE appears only in a comment", async () => {
      const findings = await scan(
        `-- CREATE TABLE "Account" ("id" text PRIMARY KEY);\n` +
          `CREATE UNIQUE INDEX "Account_providerId_key" ON "Account"("providerId");`,
      );
      const f = findings.find(
        (x) => x.ruleId === "locking/create-index-non-concurrent",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("high");
    });
  });

  describe("locking/alter-column-type", () => {
    it("flags type changes", async () => {
      const findings = await scan(
        `ALTER TABLE users ALTER COLUMN id TYPE bigint;`,
      );
      const f = findings.find((x) => x.ruleId === "locking/alter-column-type");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("high");
      expect(f!.affectedSymbols).toContain("users.id");
    });
  });

  describe("locking/add-foreign-key-without-not-valid", () => {
    it("flags FK without NOT VALID", async () => {
      const findings = await scan(
        `ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);`,
      );
      const f = findings.find(
        (x) => x.ruleId === "locking/add-foreign-key-without-not-valid",
      );
      expect(f).toBeDefined();
    });

    it("respects NOT VALID", async () => {
      const findings = await scan(
        `ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;`,
      );
      expect(
        findings.find(
          (x) => x.ruleId === "locking/add-foreign-key-without-not-valid",
        ),
      ).toBeUndefined();
    });
  });

  describe("locking/add-unique-constraint and add-primary-key", () => {
    it("flags inline UNIQUE", async () => {
      const findings = await scan(
        `ALTER TABLE users ADD CONSTRAINT u_email UNIQUE (email);`,
      );
      expect(
        findings.find((x) => x.ruleId === "locking/add-unique-constraint"),
      ).toBeDefined();
    });

    it("flags inline PRIMARY KEY", async () => {
      const findings = await scan(
        `ALTER TABLE logs ADD CONSTRAINT pk PRIMARY KEY (id);`,
      );
      expect(
        findings.find((x) => x.ruleId === "locking/add-primary-key"),
      ).toBeDefined();
    });

    it("does not flag UNIQUE USING INDEX path", async () => {
      const findings = await scan(
        `ALTER TABLE users ADD CONSTRAINT u_email UNIQUE USING INDEX u_email_idx;`,
      );
      expect(
        findings.find((x) => x.ruleId === "locking/add-unique-constraint"),
      ).toBeUndefined();
    });
  });

  describe("locking/add-check-without-not-valid", () => {
    it("flags CHECK without NOT VALID", async () => {
      const findings = await scan(
        `ALTER TABLE orders ADD CONSTRAINT chk CHECK (total >= 0);`,
      );
      expect(
        findings.find(
          (x) => x.ruleId === "locking/add-check-without-not-valid",
        ),
      ).toBeDefined();
    });

    it("respects NOT VALID", async () => {
      const findings = await scan(
        `ALTER TABLE orders ADD CONSTRAINT chk CHECK (total >= 0) NOT VALID;`,
      );
      expect(
        findings.find(
          (x) => x.ruleId === "locking/add-check-without-not-valid",
        ),
      ).toBeUndefined();
    });
  });

  describe("locking/set-not-null", () => {
    it("flags SET NOT NULL", async () => {
      const findings = await scan(
        `ALTER TABLE users ALTER COLUMN email SET NOT NULL;`,
      );
      expect(
        findings.find((x) => x.ruleId === "locking/set-not-null"),
      ).toBeDefined();
    });
  });

  describe("safety/set-default-volatile", () => {
    it("flags ALTER COLUMN SET DEFAULT now() without claiming a rewrite", async () => {
      const findings = await scan(
        `ALTER TABLE sessions ALTER COLUMN created_at SET DEFAULT now();`,
      );
      const f = findings.find((x) => x.ruleId === "safety/set-default-volatile");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("medium");
      expect(f!.message).toMatch(/does not rewrite existing rows/);
    });

    it("flags gen_random_uuid", async () => {
      const findings = await scan(
        `ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();`,
      );
      expect(
        findings.find((x) => x.ruleId === "safety/set-default-volatile"),
      ).toBeDefined();
    });

    it("leaves rewrite-causing ADD COLUMN defaults to the locking rule", async () => {
      const findings = await scan(
        `ALTER TABLE users ADD COLUMN id uuid DEFAULT gen_random_uuid();`,
      );
      expect(
        findings.find((x) => x.ruleId === "safety/set-default-volatile"),
      ).toBeUndefined();
    });

    it("flags ADD COLUMN with now() as medium deploy-sensitive behavior", async () => {
      const findings = await scan(
        `ALTER TABLE users ADD COLUMN created_at timestamptz DEFAULT now();`,
      );
      const f = findings.find((x) => x.ruleId === "safety/set-default-volatile");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("medium");
      expect(f!.message).toMatch(/migration-time generated value/);
    });

    it("parses BOM-prefixed SQL files", async () => {
      const findings = await scan(
        `\uFEFFALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();`,
      );
      expect(
        findings.find((x) => x.ruleId === "safety/set-default-volatile"),
      ).toBeDefined();
    });
  });

  describe("destructive/truncate", () => {
    it("flags TRUNCATE", async () => {
      const findings = await scan(`TRUNCATE TABLE logs;`);
      const f = findings.find((x) => x.ruleId === "destructive/truncate");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("critical");
    });

    it("notes CASCADE in the title", async () => {
      const findings = await scan(`TRUNCATE TABLE logs CASCADE;`);
      const f = findings.find((x) => x.ruleId === "destructive/truncate");
      expect(f!.title).toMatch(/CASCADE/);
    });

    it("keeps schema-qualified table names", async () => {
      const findings = await scan(`TRUNCATE TABLE public.logs;`);
      const f = findings.find((x) => x.ruleId === "destructive/truncate");
      expect(f).toBeDefined();
      expect(f!.affectedSymbols).toContain("public.logs");
      expect(f!.title).toContain("public.logs");
    });
  });

  describe("safety/update-without-where", () => {
    it("flags UPDATE without WHERE", async () => {
      const findings = await scan(`UPDATE users SET legacy = TRUE;`);
      const f = findings.find((x) => x.ruleId === "safety/update-without-where");
      expect(f).toBeDefined();
      const sql = f!.recipe?.steps[0]?.sql ?? "";
      expect(sql).not.toMatch(/\bCOMMIT\b/);
    });

    it("does not flag UPDATE with WHERE", async () => {
      const findings = await scan(`UPDATE users SET legacy = TRUE WHERE id < 10;`);
      expect(
        findings.find((x) => x.ruleId === "safety/update-without-where"),
      ).toBeUndefined();
    });
  });

  describe("safety/alter-enum-value", () => {
    it("flags rename as high", async () => {
      const findings = await scan(
        `ALTER TYPE status RENAME VALUE 'pending' TO 'awaiting';`,
      );
      const f = findings.find(
        (x) => x.ruleId === "safety/alter-enum-rename-value",
      );
      expect(f).toBeDefined();
      expect(f!.severity).toBe("high");
    });

    it("flags add as low", async () => {
      const findings = await scan(`ALTER TYPE status ADD VALUE 'archived';`);
      const f = findings.find((x) => x.ruleId === "safety/alter-enum-add-value");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("low");
    });
  });

  describe("falls back to regex when libpg_query rejects", () => {
    it("still reports DROP COLUMN via legacy path", async () => {
      // Use a SQL string that parses fine, then run with non-Postgres dialect.
      const block: SqlBlock = {
        sourceFile: "x.sql",
        ormStack: "raw-sql",
        sql: `ALTER TABLE users DROP COLUMN x;`,
        startLine: 1,
      };
      const findings = await runRules({
        sqlBlocks: [block],
        ormStack: "raw-sql",
        dialect: "mysql",
      });
      expect(
        findings.find((x) => x.ruleId === "destructive/drop-column"),
      ).toBeDefined();
    });
  });
});
